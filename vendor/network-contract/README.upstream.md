# AIPOCH Network v1 数据契约

本目录已实现独立于网站、GitHub 采集器和任何客户端的 v1 模型、JSON Schema、语义校验与合成夹具。所有夹具均为虚构，不代表真实作者、维护权限或科学结果。公开部署尚未由这些文件自动启用。

## 入口与格式

- TypeScript 入口：[index.ts](index.ts)，字段类型：[types.ts](types.ts)。
- 可移植 JSON Schema：[catalog](schema/catalog.schema.json)、[manifest](schema/manifest.schema.json)、[shard](schema/shard.schema.json)、[enhancement](schema/enhancement.schema.json)。JSON Schema 的 `$id` 是逻辑标识，不需要通过该域名下载才能验证。
- 独立合成目录：[fixtures/catalog.json](fixtures/catalog.json)。
- 格式版本：`1.0.0`；v1 新增可选字段可忽略，资源分类可扩展。状态、权限、撤回和运行状态枚举不能自行推断未知值含义；未知值必须拒绝。

公开入口为站点根下 `catalog/v1/manifest.json`，与网站搜索索引分开。manifest 形状为：

```json
{
  "contract_version": "1.0.0",
  "snapshot_id": "example-snapshot",
  "generated_at": "2026-09-12T00:00:00.000Z",
  "collections": {
    "sources": [], "actors": [], "organizations": [], "projects": [],
    "resources": [], "collections": [], "relations": [], "claims": [], "tombstones": []
  }
}
```

每个集合都是分片描述列表；空列表表示该集合没有分片。分片描述为 `{href, sha256, bytes, count?}`：`sha256` 校验下载文件的原始 UTF-8 字节，`bytes` 为字节数，`count` 缺失表示未提供数量，不等于零。每个分片自身为 `{contract_version, snapshot_id, collection, records}`。分片的版本和快照必须与一次读取的 manifest 一致，记录种类必须与 `collection` 对应。生成方先完成并验证全量分片，再将 manifest 和所有分片作为完整站点产物发布。

`href` 相对**包含该引用的文件**解析，不相对域名根；必须是目录范围内的安全相对路径。禁止绝对路径、跨域地址、路径遍历、反斜线、查询串、片段、编码的遍历和多重编码。`resolveCatalogHref` 额外接受显式目录发布根，检查最终位置未越界，因此支持 GitHub Pages 仓库子路径。生成方不得复用同一个 `href` 表达不同集合。

## 字段字典

| 对象/字段 | 约束与含义 |
| --- | --- |
| 所有展示对象 | `id, kind, title, status, updated_at, provenance` 必填；`description` 可省略。`status` 是 `candidate` 或 `listed`，不代表认证。`title` 和已发布的 `description` 必须有字段溯源 |
| `sources` / `source_repository` | 真实 GitHub 仓库。`provider='github'`、数字 `provider_id`、`canonical_url`、`owner_id`、`availability`、`archived`、`observed_at`、`stale`、`license`、`aliases` 必填。README、默认分支、语言、Stars、最新 commit 等未知时省略 |
| `sources.collaboration` | 可选 `{issues_url?, discussions_url?}`，均为安全 HTTPS 地址。仅从公开观察中明确启用的 GitHub 功能生成规范仓库下的 `/issues`、`/discussions`，字段溯源记录观察时间；来源内容超过七天未核实或被撤下时不保留。缺失表示未提供入口，不推断贡献文件位置；旧消费者可忽略整个可选字段 |
| `actors` / `actor` | GitHub 账号，`account_type='user'|'organization'`。维护 `login, canonical_url, provider_id, aliases`，不等同实名身份 |
| `organizations` / `organization` | 组织 Actor 的展示扩展；`id` 必须等于 `actor_id`，Actor 必须为 organization。`source_ids, resource_ids` 是明确策展范围；普通收录使用 `participation='community_indexed'` |
| `projects` / `project` | 有自身稳定 ID 的研究工作；`domains, source_refs, resource_ids` 必填，`question` 可选。项目可以跨多个来源，不能用一个仓库自动推断研究目标 |
| `resources` / `resource` | 独立资源；`resource_type, domains, source_refs, project_ids, license, runtime` 必填。可选 `inputs, outputs, conditions, documentation_url, download_url` 只描述已知内容 |
| `collections` / `collection` | 稳定 ID 的有序策展集合；`actor_ids, item_ids, selection_basis` 必填。不复制被引用对象来建立新的身份 |
| `relations` / `relation` | `from_id, to_id, type, evidence, recorded_at` 必填；支持使用、产出、参考、作者、维护、策展、fork、派生、替代和拆分关系。自引用及断裂引用被拒绝 |
| `claims` / `claim` | 声明主体、对象、类型、范围、状态、证据和复核触发条件分别记录。核验维护权、组织策展、运行证据和科学验证是不同类型，不存在统一“已验证”状态 |
| `tombstones` / `tombstone` | 稳定 ID、`status='withdrawn'|'superseded'`、`withdrawn_at`；只允许可选 `replacement_id, reason`。严格禁止额外属性，避免撤回后继续保留描述或地址 |

资源类型预置 `tool, method, workflow, skill, dataset, model, reproduction, unknown`。未来新增满足小写标识符规则的分类可由旧消费者用 `Other resource` 展示；未知类型不能引入可运行或已验证含义。

`availability` 为 `accessible, temporarily_unavailable, unknown, private, deleted`。一次失败只能用 `temporarily_unavailable` 并标记 `stale=true`；不能直接判为删除。`private` 可以用于内部观察，但公开目录校验拒绝此来源记录，生成方必须按撤回策略移除具体内容、保留最小 tombstone。归档使用独立 `archived`，不自动撤回。

## 稳定身份、来源定位与溯源

`source:github:<数字仓库 ID>` 和 `actor:github:<数字账号 ID>` 由 GitHub 永久身份生成；改名和转移不改变它们。URL 归一化仅产生待解析候选，不能凭 owner/name 生成已确认的来源 ID。历史别名为 `{url, verified_at, provider_id}`，必须与当前来源的数字 ID 一致。旧 URL 被新仓库占用不继承旧身份，fork 也保留自身 ID。

研究项目、资源、集合、关系和声明使用 `<kind>:<不变 key>`。key 由目录创建时分配并持久保存，允许小写字母、数字、点、下划线和连字符，最长 128 个字符；不要在更新时根据名称、URL 或文件路径重新生成。

每个 `source_refs` 项为 `{source_id, role, path?, commit?, ref?, url?, sha256?, resolved_at?}`。`role` 是 primary/documentation/implementation/data/evidence/related。`commit` 必须是完整 40 位小写 Git SHA；`ref` 可保存可移动 branch/tag，但不算固定版本。tag 解析后保存 commit 与 `resolved_at`。`sha256` 为 64 位小写摘要，必须绑定 commit 或外部内容 URL。项目、资源可引用多个来源，一个来源可被多个资源引用，数组不蕴含作者身份或依赖关系。

字段 `provenance` 按字段名保存一个或多个来源：`{role, url, observed_at, review, source_id?, actor_id?, path?, commit?, scope?, method?}`。`role` 区分 GitHub、社区、维护者、目录编辑和自动生成；`review` 是 pending/reviewed/disputed/stale。路径或 commit 溯源必须明确 source_id。冲突证据可以并存并指定 scope；不要通过单一覆盖优先级抹去其他声明。

所有时间使用严格 UTC：`YYYY-MM-DDTHH:mm:ssZ` 或 `YYYY-MM-DDTHH:mm:ss.sssZ`。非法日期、空字符串和未声明的 null 均拒绝。外部 URL 使用无凭据 HTTPS，禁止用户名密码和显式凭据查询参数。目录及来源路径不得遍历上级目录。

## 权限、许可与核验

`license.status` 为 `unknown, identified, conflicting`。未知许可可继续基础收录，但不能同时标注确定的许可名称或 SPDX ID。确定许可必须带名称/SPDX 及来源 URL；冲突保留不确定性，目录不能授予更宽使用权限。

`runtime.status` 为 `not_described, maintainer_described, community_described`。后两者必须有运行说明 URL；提供运行说明不表示 AIPOCH 执行过，也不表明支持任何指定客户端。

Claim 的 verified 必须有 `verified_by, verified_at` 和 reviewed evidence。组织策展还必须明确 `organization_owner` 或 `delegated_by_owner` 权限，普通成员、PR 贡献和 repository_maintainer 不足以授予组织代表权。组织主动态度必须由单独的 verified organization_curation claim 支持。所有校验只能验证**声明结构与依据记录**；是否确有权限仍须维护者在受信任审核流程中核验，不能将通过 JSON Schema 当作权限证明。

`recheck_on` 明确转移、改名、权限变更、证据到期和争议等复核触发条件。证据过期、状态撤销或范围变化后应更新 claim；不能把旧认领跟随别名交给新身份。

## 校验接口与可选增强

`validateCatalog, validateManifest, validateShard, validateEnhancement` 返回 `{ok, errors}`；`assertValidCatalog` 在失败时抛出可读错误。完整目录校验先执行 JSON Schema，再检查稳定身份、对象引用、类别、字段溯源、许可、认领及 tombstone 隐私约束。单个 shard 校验没有其他 shard 的上下文，消费者组装完成后仍需执行完整引用和状态检查。

可选的**公共记录增强包**为 `{contract_version, source_url, projects?, resources?}`，至少包含 projects/resources 之一，内容使用同一归一化 Project/Resource 类型。`validateEnhancement` 仅验证这些公共记录结构，不是 CLI 的目录编写文件入口。实际编写并应用补充项目/资源/关系使用 [registry 增强格式及 applyRegistryEnhancement](../registry/README.md)。来源身份、编辑审核与最终引用在同一归一化管线检查；增强缺失、解析失败或校验失败不影响已通过 URL 校验的基础投稿。两种格式均不含可执行 hook。

目录已能通过显式 `source_refs` 保存完整 commit、路径、角色和可选摘要；后续来源刷新不会改写这些声明。未提供的解析时间不补写，当前分支的许可和描述不冒充历史内容的事实。请结合 `provenance.source_refs` 判断它是已经观察到的版本还是目录编者声明的位置；固定标识本身不证明文件可用或执行成功。

关系的语义校验还要求：produces 为 Project → Resource，fork_of 为 SourceRepository → SourceRepository，作者/维护/策展关系指向 Actor，uses 的发起者为 Project/Resource 且目标为 SourceRepository/Resource，supersedes 两端为同类对象。端点 ID 与对象类型、证据引用分别验证，关系不会自动赋予维护权或科学有效性。

可移植 Schema 使用四个自定义格式：`utc-date-time`（上述严格 UTC）、`safe-https-url`（无凭据 HTTPS）、`safe-relative-path`（发布范围内相对 URL 路径）、`safe-repository-path`（Git 相对路径，可含普通空格和非英文字符，禁止遍历、控制字符及 URL 歧义字符）。从 Git 路径构造外部 URL 时需逐段编码。独立实现必须按本文补齐这些格式及跨对象语义检查，不能在忽略未知 format 后宣称完成全部安全校验。

```sh
node --import tsx --test spec/tests/*.test.ts
node --import tsx spec/export-schema.ts
```

第二条仅在有意修改契约时重导出 JSON Schema 和固定 JSON 夹具；测试检查公开 schema 与实际实现一致。破坏性变更应创建新契约版本，不得通过重导出悄悄修改 v1 已发布语义。

发布边界：当前生成器不输出来源完整 `readme`（该可选字段仅为兼容保留），只输出目录所需元数据与证据链接。分片默认最多 200 条且最多 4 MB，固定快照身份包含分片参数；改变分片不会覆写原固定地址。
