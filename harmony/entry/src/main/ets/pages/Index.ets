import { webview } from '@kit.ArkWeb';
import { relationalStore } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';
import { common, Want, wantConstant } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { fileIo } from '@kit.CoreFileKit';
import { buffer } from '@kit.ArkTS';
import { fileUri } from '@kit.CoreFileKit';

/** 单元格值：RDB 无列类型元数据，统一按文本返回，前端用 Number()/String() 显式转换 */
type CellValue = string | null;

/** 原生 httpPost 的返回结构（ArkTS 要求对象字面量对应显式类型） */
interface HttpResult {
  status: number;
  body: string;
}

/**
 * 注入给 WebView 的原生桥（window.HarmonyBridge）：
 * - dbExecute / dbSelect：relationalStore(SQLite) 数据库桥
 * - httpPost：原生 HTTP 转发（绕过 WebView CORS）
 * 前端约定见 src/services/localDb.ts 与 src/services/weread.ts（bridge:// 协议）。
 */
class HarmonyBridge {
  private store: relationalStore.RdbStore | null = null;
  private context: common.UIAbilityContext | null = null;
  /** 写操作串行队列：RDB 的事务（beginTransaction/commit/rollBack）是连接级全局状态，
   * 并发批写会互相提交/回滚对方的未落库行，造成静默丢数据（实测 263 本书想法全部丢失） */
  private writeChain: Promise<void> = Promise.resolve();

  setContext(ctx: common.UIAbilityContext): void {
    this.context = ctx;
  }

  /** 所有写操作排队执行（FIFO）；前序失败不阻塞后续任务，本任务错误正常抛给调用方 */
  private enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const prev = this.writeChain;
    let release: () => void = () => {};
    this.writeChain = new Promise<void>((resolve: () => void) => {
      release = resolve;
    });
    return (async (): Promise<T> => {
      try {
        await prev;
      } catch {
        // 前序任务失败不影响本任务执行
      }
      try {
        return await task();
      } finally {
        release();
      }
    })();
  }

  private async getStore(): Promise<relationalStore.RdbStore> {
    if (this.store) {
      return this.store;
    }
    if (!this.context) {
      throw new Error('UIAbility context 未初始化');
    }
    const config: relationalStore.StoreConfig = {
      name: 'weread.db',
      securityLevel: relationalStore.SecurityLevel.S1,
    };
    try {
      this.store = await relationalStore.getRdbStore(this.context, config);
    } catch (e) {
      const err = e as BusinessError;
      throw new Error(`getRdbStore 失败: ${err.message}`);
    }
    return this.store;
  }

  /** 执行写语句（DDL/DML）。executeSql 无受影响行数返回，恒返回 0（前端未使用返回值） */
  async dbExecute(sql: string, params?: Array<relationalStore.ValueType>): Promise<number> {
    return this.enqueueWrite(async (): Promise<number> => {
      try {
        const store = await this.getStore();
        await store.executeSql(sql, params ?? []);
        return 0;
      } catch (e) {
        const err = e as BusinessError;
        throw new Error(`dbExecute 失败: ${err.message} SQL: ${sql.slice(0, 80)}`);
      }
    });
  }

  /** 批量写：同一 SQL 多组参数在单事务内执行（同步大量行时避免逐条跨桥调用）。
   * 经串行队列执行，事务不再与其他写操作交错 */
  async dbExecuteBatch(sql: string, paramsList: Array<Array<relationalStore.ValueType>>): Promise<number> {
    if (paramsList.length === 0) {
      return 0;
    }
    return this.enqueueWrite(async (): Promise<number> => {
      let store: relationalStore.RdbStore;
      try {
        store = await this.getStore();
      } catch (e) {
        const err = e as BusinessError;
        throw new Error(`dbExecuteBatch 获取连接失败: ${err.message}`);
      }
      store.beginTransaction();
      try {
        for (const params of paramsList) {
        // JS null 跨桥后可能变为 undefined（不在 ValueType 联合内），统一归一为 null
        const safe: Array<relationalStore.ValueType> = [];
        for (const v of params) {
          safe.push(v === undefined ? null : v);
        }
        await store.executeSql(sql, safe);
        }
        store.commit();
        return paramsList.length;
      } catch (e) {
        store.rollBack();
        const err = e as BusinessError;
        throw new Error(`dbExecuteBatch 失败: ${err.message} SQL: ${sql.slice(0, 80)} 共 ${paramsList.length} 行`);
      }
    });
  }

  /** 查询语句，返回行对象数组（数字列为 number，文本列为 string，空为 null） */
  async dbSelect(sql: string, params?: Array<relationalStore.ValueType>): Promise<Array<Record<string, CellValue>>> {
    try {
      const store = await this.getStore();
      const resultSet = await store.querySql(sql, params ?? []);
      const rows: Array<Record<string, CellValue>> = [];
      while (resultSet.goToNextRow()) {
        const row: Record<string, CellValue> = {};
        for (let i = 0; i < resultSet.columnCount; i++) {
          const name = resultSet.getColumnName(i);
          if (resultSet.isColumnNull(i)) {
            row[name] = null;
          } else {
            // 统一 getString：华为 RDB 的 getLong 对文本列不抛异常而是宽容返回 0，
            // 会把书名/内容等文本列整体变成 0（实测）。前端读取端已全面
            // Number()/nullable* 归一 + SQL 层 CAST，全字符串方案三端安全。
            row[name] = resultSet.getString(i);
          }
        }
        rows.push(row);
      }
      resultSet.close();
      return rows;
    } catch (e) {
      const err = e as BusinessError;
      throw new Error(`dbSelect 失败: ${err.message} SQL: ${sql.slice(0, 80)}`);
    }
  }

  /** 把 base64 文件写入缓存目录并调起系统分享面板（导出图片/PDF 的原生出口） */
  async shareFile(base64: string, fileName: string, mime: string): Promise<boolean> {
    if (!this.context) {
      throw new Error('UIAbility context 未初始化');
    }
    const dir = this.context.cacheDir;
    const filePath = `${dir}/${fileName}`;
    const data: Uint8Array = new Uint8Array(buffer.from(base64, 'base64').buffer); // decode
    console.info(`[weread-diag] shareFile: ${fileName} mime=${mime} 解码字节数=${data.byteLength}`);
    const file = fileIo.openSync(filePath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
    try {
      fileIo.writeSync(file.fd, data);
    } finally {
      fileIo.closeSync(file);
    }
    // want 协议调起系统分享面板
    const shareWant: Want = {
      action: 'ohos.want.action.sendData',
      uri: fileUri.getUriFromPath(filePath),
      type: mime,
      flags: wantConstant.Flags.FLAG_AUTH_READ_URI_PERMISSION,
    };
    this.context.startAbility(shareWant);
    return true;
  }

  /** 原生 POST 转发到微信读书网关（WebView 内 fetch 有 CORS 限制） */
  async httpPost(path: string, headers: Record<string, string>, body: string): Promise<HttpResult> {
    const realUrl = `https://i.weread.qq.com/${path}`;
    const client = http.createHttp();
    try {
      const resp = await client.request(realUrl, {
        method: http.RequestMethod.POST,
        header: headers,
        extraData: body,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 15000,
        readTimeout: 15000,
      });
      const result: HttpResult = {
        status: resp.responseCode,
        body: typeof resp.result === 'string' ? resp.result : '',
      };
      // 诊断日志：想法接口在鸿蒙直连下返回空列表的排查（仅该接口打印，避免刷屏）
      if (body.includes('review/list/mine')) {
        console.info(`[weread-diag] review请求: ${body.slice(0, 150)}`);
        console.info(`[weread-diag] review响应: HTTP ${result.status} 长度${result.body.length} 头部: ${result.body.slice(0, 300)}`);
      }
      return result;
    } catch (e) {
      const err = e as BusinessError;
      throw new Error(`httpPost 失败: ${err.message} URL: ${realUrl}`);
    } finally {
      client.destroy();
    }
  }
}

@Entry
@Component
struct Index {
  controller: webview.WebviewController = new webview.WebviewController();
  bridge: HarmonyBridge = new HarmonyBridge();

  aboutToAppear(): void {
    // 预热 Web 引擎，加快首屏
    webview.WebviewController.initializeWebEngine();
    const ctx = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.bridge.setContext(ctx);
  }

  build() {
    Column() {
      Web({ src: $rawfile('web/index.html'), controller: this.controller })
        .onControllerAttached(() => {
          // 属性式 javaScriptProxy 在引擎预热 + rawfile 场景下注入时机晚于首个页面加载，
          // 导致 window.HarmonyBridge 缺失（hilog: native proxy object not found）。
          // onControllerAttached 在任何页面加载前触发，注册必然生效。
          this.controller.registerJavaScriptProxy(this.bridge, 'HarmonyBridge',
            ['dbExecute', 'dbExecuteBatch', 'dbSelect', 'httpPost', 'shareFile']);
        })
        .domStorageAccess(true)
        .databaseAccess(true)
        .fileAccess(true)
        .mixedMode(MixedMode.All)
        .zoomAccess(false)
        .onErrorReceive((event: OnErrorReceiveEvent) => {
          console.error(`[ArkWeb] 加载错误: ${event.error.getErrorInfo()}`);
        })
        .onConsole((event: OnConsoleEvent) => {
          const msg = `[H5 Console] ${event.message.getMessageLevel()}: ${event.message.getMessage()}`;
          if (event.message.getMessageLevel() === MessageLevel.Error) {
            console.error(msg);
          } else {
            console.info(msg);
          }
          return false;
        })
        .onPageEnd(() => {
          console.info('[ArkWeb] 页面加载完成');
        })
        .width('100%')
        .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#f3f6fb')
  }
}
