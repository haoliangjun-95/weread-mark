import { webview } from '@kit.ArkWeb';
import { relationalStore } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';

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

  setContext(ctx: common.UIAbilityContext): void {
    this.context = ctx;
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
    try {
      const store = await this.getStore();
      await store.executeSql(sql, params ?? []);
      return 0;
    } catch (e) {
      const err = e as BusinessError;
      throw new Error(`dbExecute 失败: ${err.message} SQL: ${sql.slice(0, 80)}`);
    }
  }

  /** 批量写：同一 SQL 多组参数在单事务内执行（同步大量行时避免逐条跨桥调用） */
  async dbExecuteBatch(sql: string, paramsList: Array<Array<relationalStore.ValueType>>): Promise<number> {
    if (paramsList.length === 0) {
      return 0;
    }
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
        await store.executeSql(sql, params);
      }
      store.commit();
      return paramsList.length;
    } catch (e) {
      store.rollBack();
      const err = e as BusinessError;
      throw new Error(`dbExecuteBatch 失败: ${err.message} SQL: ${sql.slice(0, 80)} 共 ${paramsList.length} 行`);
    }
  }

  /** 查询语句，返回行对象数组（值统一为字符串或 null，前端显式转换类型） */
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
            ['dbExecute', 'dbExecuteBatch', 'dbSelect', 'httpPost']);
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
