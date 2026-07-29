# Arcana Cube

一个本地优先的万智牌 Cube 管理器。它管理准确印刷版本、Foil 状态、日印标记、本地高清卡图、MTGJSON 美元价格、价格历史和 Cube 改动记录。

## 主要功能

- 网格与单行列表视图，按颜色、类别、表面工艺和印刷产地筛选
- 按牌名模糊搜索，或用“系列代码 + 收藏编号”定位准确版本
- 在牌表中切换同一卡牌的纸质印刷版本、Foil / Non-Foil 和日印标记
- 导入文本或 Excel，写入前检查 Scryfall 匹配、重复项和已有牌
- 导出可重新导入的 Excel，并生成包含牌表、价格历史与改动记录的完整 JSON 数据备份
- 按正面颜色与类别统计，查看颜色法力曲线、平均法力值和总价
- 记录逐卡与总价的每日历史、价格涨跌，并可用 MTGJSON 补齐有限历史
- 在卡牌大图档案中显示当前印刷版本与表面工艺对应的补充包、预组和其他产品来源
- 文件夹模式保存完整数据与高清卡图，可随整个目录迁移
- 只读文件夹健康检查，发现缺图、孤立图片、重复引用和不完整记录
- Excel 组件随项目保存在本地，断网时仍可导入与导出已有数据

## 本地运行

需要 Node.js 22 或更高版本。在项目目录运行：

```sh
npm run serve
```

然后访问 [http://127.0.0.1:4173/](http://127.0.0.1:4173/)。直接双击 `index.html` 可以浏览已有牌表、产品来源和仓库内的 MTGJSON 价格索引；牌张搜索、在线版本查询和补全卡图需要通过本地服务器运行。

macOS 可以直接双击项目根目录的 `启动 Cube.command`，它会启动或复用本地服务器并在 Chrome 打开页面。如果默认端口 4173 已被其他程序占用，启动器会自动选择后续可用端口。使用完毕后可双击 `停止 Cube.command` 结束本项目的后台服务。

## 在线版本

GitHub Pages 在线版本位于 [https://tiancaigk.github.io/arcana-cube/](https://tiancaigk.github.io/arcana-cube/)。仓库中的 `cube-data.json` 是首次访问时展示的公开牌表；已有浏览器牌表和用户连接的本地文件夹优先，不会被公开牌表覆盖。在线卡图从 Scryfall 加载，真实价格历史、改动记录和本地高清图片不会发布。

局域网测试时可显式监听所有网卡：

```sh
npm run serve -- --host 0.0.0.0 --port 4173
```

## 文件夹模式

Chromium 浏览器支持 File System Access API。点击“选择 Cube 文件夹”并授权后，运行数据保存在：

```text
Cube/
├── cube-data.json
├── price-history.json
├── change-log.json
└── images/
    ├── <系列>-<编号>-<卡名>.png
    └── thumbnails/
        └── <系列>-<编号>-<卡名>.webp
```

- `cube-data.json` 是主牌表，包含版本、表面工艺、日印状态和图片引用。
- `price-history.json` 保存每日逐卡与总价快照。
- `change-log.json` 保存添加、删除、换版本、导入和价格更新记录。
- `images/` 保留高质量原图；`images/thumbnails/` 是牌表加载用的 360px WebP 缓存。
- “补全本地卡图”会下载缺失原图，并从已有原图生成缩略图。
- “检查文件夹”只读取数据与图片目录，不会自动删除或重命名文件。

移动到另一台电脑时复制整个文件夹，启动页面后重新选择该目录。浏览器仍保留一份本地镜像，但文件夹中的三个 JSON 文件才是可移动的数据集合。

## 数据兼容

工作区与 JSON 备份包含独立的 `dataVersion`。旧数据会按 [migrations.js](./migrations.js) 中的顺序升级；较新且当前程序无法理解的数据版本会停止加载，避免静默损坏。

格式示例位于：

- `examples/cube-data.example.json`
- `examples/price-history.example.json`
- `examples/change-log.example.json`

## 产品来源

卡牌大图右侧的“获取方式”来自 [MTGJSON](https://mtgjson.com/)；应用使用 Scryfall ID 匹配当前具体印刷版本，并分别解析 Foil、Non-Foil 与 Etched 的 `sourceProducts`。预组显示为“固定收录”，补充包显示为“随机可能开出”。单包、盒和箱等共享同一卡池的产品会合并显示，MTGO 等非实体发行会被排除。

当前牌表发生版本增删后，可重新生成精简索引：

```sh
npm run build:product-sources
```

构建器只在维护时下载相关系列数据并写入 `product-source-index.json` 与 `product-source-index.js`；通过服务器访问时读取 JSON，直接双击打开 `index.html` 时自动延迟加载同内容的 JS 索引。MTGJSON 内容按其 [MIT License](https://mtgjson.com/license/) 使用。

## 价格来源

当前价格来自 MTGJSON 的实体卡零售价，并严格按当前具体印刷版本和 Foil / Non-Foil 工艺匹配。提供商顺序固定为：

1. TCGplayer
2. ManaPool
3. Card Kingdom
4. Cardmarket EUR，按价格日期换算为 USD

前三档缺失时才会使用 Cardmarket。汇率通过 [Frankfurter](https://frankfurter.dev/) 取得 ECB 的 EUR/USD 历史参考汇率；周末和节假日采用此前最近一个工作日的汇率。换算后的价格点同时保存汇率数值和汇率日期，便于追溯。Scryfall 继续负责卡牌资料、版本和图片，不参与价格兜底。

每次刷新会保存价格来源、提供商和数据日期；每日快照保留紧凑的来源统计。版本选择弹窗也使用同一提供商顺序，并通过轻量的可选版本索引显示每个实体版本的最新 Foil / Non-Foil 价格；选中版本时会立即写入对应的 MTGJSON 价格，不再沿用 Scryfall 报价。总价历史弹窗中的“同步近 90 天”会用 MTGJSON 逐卡数据重建最近 90 个自然日内有源数据的每日快照和总价；更早的记录以及窗口内 MTGJSON 完全缺少的日期保持不变。

网页不会下载超过 1 GB 的 MTGJSON 完整价格 JSON。维护脚本将当前牌表的有限历史，以及这些牌名所有实体版本的最新价格，压缩为 `mtgjson-price-index.json` 与供本地直开使用的 `mtgjson-price-index.js`。首次扩展版本目录时需要发现并映射所有可选印刷版本，后续每日构建会复用索引中的映射：

```sh
# 合并当天价格，供日常和自动任务使用
npm run build:prices

# 首次建立或重新补齐 MTGJSON 提供的有限历史
npm run build:prices:history
```

GitHub Actions 每天生成当天精简索引并提交；本地运行仍可使用仓库中最后一次生成的索引。

## 中文牌名

中文显示优先使用 Scryfall 的简体中文实体牌名；Scryfall 没有简体中文记录时，通过 [MTGCH](https://mtgch.com/) 补充简体中文名。不会使用繁体中文作为回退。连体牌显示两半的完整中文名，双面牌在牌表中只显示正面中文名。

## 开发结构

`app.js` 是浏览器组合入口，负责状态变更、DOM 事件和用户反馈；可测试的业务能力拆分在独立 UMD 模块中：

- `core.js`、`migrations.js`：卡牌规则、导入导出和数据迁移
- `basicLands.js`：五种基本地的编号解析、分组和批量判定
- `collectionCommands.js`、`viewPreferences.js`：收藏变更副作用和非关键视图偏好
- `scryfall.js`、`catalog.js`：Scryfall 请求与卡牌目录查询
- `productSources.js`、`product-source-index.json`、`product-source-index.js`：MTGJSON 产品来源查询，以及服务器与本地直开模式的精简索引
- `mtgjsonPrices.js`、`mtgjson-price-index.*`：MTGJSON 价格选择、历史序列和轻量运行时索引
- `storage.js`、`workspace.js`、`persistence.js`：浏览器镜像、文件夹读写和按域保存
- `imageCache.js`：高清原图与 WebP 缩略图缓存
- `priceHistory.js`、`changeLog.js`、`health.js`：历史记录和工作区检查
- `selectors.js`、`renderScheduler.js`：派生数据缓存与分区渲染

完整的模块职责、数据流和扩展规则见 [docs/architecture.md](./docs/architecture.md)。新增可复用逻辑时优先放入对应模块并补同名 `*.test.js`，让 `app.js` 保持为协调层。

## Git 边界

Git 跟踪应用代码、测试、文档、空示例数据、用于在线展示的 `cube-data.json` 和不含私人状态的 MTGJSON 精简价格索引。个人价格历史、改动记录、卡图与本地审计输出仍在 `.gitignore` 中排除，避免把非公开运行数据误提交到代码历史。

## 原型备用区

[`prototypes/foil-effects-22/`](./prototypes/foil-effects-22/) 保存使用 `FCA #4 Counterspell` 对比 22 种 Foil 材质的独立研究页面。该目录包含自己的来源与许可证说明，不会被正式应用加载。

## 验证

```sh
npm run check
npm test
npm run test:browser
```

测试包含 600 张牌和 180 天价格历史的确定性回归夹具。提交前应同时运行语法检查与完整测试；浏览器行为还需在本地服务器页面做烟雾验证。
