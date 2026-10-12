# 雲端草稿與整批送件：接入及驗收

本次只新增發票／繳費單的雲端草稿與整批送件 API。每張申請使用明確的 UUID、operation key 與正式 `batch_id`；不使用姓名、事由或日期推測合併。一般舊 RPC 保留原本 500／150 上限。超量送件必須走保存、分段校驗、完整發布，不能呼叫多次一般送件湊成一張。

## 狀態與權限

`draft → staging → ready → committed`。草稿可修改；開始送件後內容凍結，只有相同 ordinal＋內容雜湊可重傳。未成立的 staging／ready 可以 reopen，會增加 revision、清除 staging 並更換 operation key；已正式成立只能經既有抽單流程處理。

每次 RPC 重新驗證 `auth.uid()`、`current_finance_user()`、啟用狀態、tenant 與資料環境。owner 永遠取伺服器身分，不接受 client owner。不同 auth UID、finance user ID、tenant 或環境均不可取得同一 UUID 的內容。所有草稿表在 private schema，開啟 RLS 且無直接使用者授權；只有八個具明確身分檢查的公開 RPC。

修改採 revision CAS；相同內容因回應遺失重試會回同版，不新增。列表使用 `(updated_at,id)` cursor；每頁最多 100。列表不傳完整 payload。

## 前台接入

```js
const cloud = FinanceCloudSubmission.create({
  rpc: (name, args) => _sb.rpc(name, args),
  identity: () => `${authUid}|${tenantId}|${financeUserId}|${environment}`,
  onProgress: ({phase, saved, total}) => renderProgress(phase, saved, total)
});
const saved = await cloud.save({
  id: stableDraftUuid, revision: lastKnownRevision || 0,
  kind: 'invoice', environment: 'production',
  payload: {title: '開立事由', items: originalRpcItems, ui: formSnapshot},
  files: uploadedReferences
});
const receipt = await cloud.stageAndCommit(saved);
// receipt.result is the existing submit RPC receipt: {ok, count, rows, batch_id, ...}
```

- 未完整表單可 `payload.items=[]` 保存，`payload.ui` 放可還原的欄位與明細。送出前仍經原有表單驗證、產生完整 items，save 同 UUID 新版後才 stageAndCommit。
- `read(id, environment)` 回完整 payload/files；`list(environment,cursor,limit)` 回 rows/nextCursor。恢復畫面讀 payload.ui，恢復已凍結送件讀 payload.items。
- 每 item 必須保留穩定 `client_item_key`。每次 stage 最多 100 筆，每申請 1–2000 筆、payload 最多 8 MiB、單筆最多 64 KiB。
- 同一申請須同法人、部門、簽核路線；逐筆附件可不同，不把附件內容當簽核路線。所有欄位仍由原正式 RPC 再驗證。
- files 格式 `{bucket:'finance-attachments',path,name}`。伺服器同時核對附件中繼資料、Storage 實物、同本人及環境；僅本機選檔不可顯示已保存。nested Blob、blob URL、data URL 會被拒絕。未上傳完成檔案只能保留「需重新選取」的檔名提示。
- 被未成立雲端草稿引用的附件受刪除／覆寫保護，不能被既有孤兒清理刪除。放棄草稿或移除引用後允許清理。正式送出前核對所有檔案 reference 確實出現在 items。
- save 回 `operationKey` 是權威值，reopen 後同步更新前台 recovery marker，不能自行沿用舊 key。
- `reconcileSave({id,kind,environment,payload,files})` 比較完整 canonical payload（包括 ui 與 items）及 files、kind、environment，只有完全相同才回目前伺服器 revision/state。save 回應遺失、版本衝突或已鎖定時亦自動回查。內容不同以 PT409 保留雙方版本，不依局部 UI 或 revision 猜測成功。read 的 42501 不區分不存在與他人草稿，不能宣稱已證明不存在。
- engine 每個 RPC 預設 30 秒上限，commit 預設 90 秒；逾時保留原 UUID，commit 回應不明會 read 同 UUID，不建立新申請。可設定 timeoutMs（最高 60 秒）、commitTimeoutMs（最高 120 秒）。

## 原子性與容量

所有 chunk 都只是 private staging，不新增正式單據或通知。commit 對草稿加 row lock、重验 revision/count/fingerprint/附件，再呼叫來源雜湊釘定的原 submit 函式私有副本。除容量 validation 與繳費 bulk 暫存陣列累加方式外保留原授權、逐筆欄位規則、編號、原子性與既有 triggers。任一正式資料或 trigger 失敗，整筆交易回滾，原 staging 可恢復。

同時更新正式簽核、收款、補件重送及抽單的下游容量到 2000，保留原 CAS／整批完整性／會計及權限限制。普通 submit RPC 沒有擴大上限。

正式環境讀到 authenticated/authenticator 為 8 秒逾時。依 [Supabase 的函式層級逾時設定](https://supabase.com/docs/guides/database/postgres/timeouts)，只對新 commit 與受影響的整批操作 RPC 設 50 秒；不變更角色或全資料庫的逾時。發布後須 schema reload 並驗證 REST timeout 設定生效。

## 已完成的本地證據

- `node scripts/test_cloud_submission_engine.cjs`：26 項，包括 key 順序變化、201 筆分三段、連點、失聯回查、半批停止、切換身分、未上傳檔案與有界逾時。
- `node scripts/check_cloud_submission_v1.cjs`：PGlite 執行 migration 與擷取正式 submit SQL，真實 SQL 執行，不是只比對字串；fixture 的其他依賴為隔離虛構資料。
- `FINANCE_NATIVE_PG_CONFIG=<owner-only-loopback-json> node scripts/test_cloud_submission_native.cjs`：先執行完整 SQL 案例，再以 PostgreSQL 17.6 的兩個實體連線驗證同筆 commit 等鎖後只成立一次、reopen 阻擋舊 commit、兩裝置 CAS。
- 容量案例為 501／2000 發票及 151／2000 繳費，均只有一個正式 batch_id。59 項 SQL 檢查與 7 項容量／雙連線檢查已通過；2001 拒絕且不新增正式資料。
- 存取案例含其他身分、tenant、資料環境、停權、anon、私有表直讀、猜測附件及覆寫附件。
- 任一最後正式列 trigger 故障時零部分寫入，重開原草稿修正後可完成。
- `scripts/finance_cloud_submission_postflight.sql` 是只讀發布檢核；所有 `ok` 都必須為 true。migration 會在任何原 submit／下游函式來源漂移時拒絕執行。

私有繳費提交副本使用 `jsonb[]` 暫存已驗證列與回執，最後一次序列化，避免原逐次 `jsonb_concat` 的平方級複製；正式 INSERT 仍只有一次，原 public RPC 未改。

Native 容量數字只衡量本地合成依賴，不含完整正式報表、通知、歷程、憑證 trigger 的成本，不能當正式效能承諾；最新逐次耗時与 migration SHA 記在本地 evidence JSON。

## 正式發布仍須驗收

1. 以隔離測試環境／虛構角色驗證實際前台保存→關分頁→新瀏覽器還原→一次送出，以及完整附件預覽。
2. 用正式 schema 與全套 trigger 在測試環境跑 501／2000，確認簽核待辦及通知只有一張申請，歷史列表可回查；簽核、抽單、補件、收款不得被舊上限擋下。
3. 網路丟棄 commit 回應、兩裝置同時送件、停權後重試，均需 server read 查到唯一結果；不得靠前台本地狀態宣布成功。
4. 檢查原有普通發票／繳費、附件清理及明細更正流程回歸。當最大容量受伺服器資源限制，顯示原草稿與可回查狀態，不分拆建立正式單据。
5. 正式發布由整合／release 流程執行；本子項未直接寫入或部署正式資料庫。

目前不是背景 worker：使用者發起分段與一次原子 commit，關 APP 後已完成資料保留；尚未送出的分段在恢復時續傳，不聲稱關閉 APP 仍自動持續上傳。更廣泛支出單既有草稿與手機 APP 不在此 API 的文件種類內。
