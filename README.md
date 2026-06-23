# Arcana Cube

一个本地优先的万智牌 Cube 管理器原型。无需安装依赖，直接在浏览器打开 `index.html` 即可使用。

## 功能

- 牌表网格与列表视图
- 在牌表内查看并自由切换同一卡牌的不同印刷版本
- 名称、类型、颜色筛选
- 总牌数、平均费用、类别和颜色统计
- 通过 Scryfall 按牌名或“系列代码 + 收藏编号”查找并添加准确版本
- 导入纯文本牌表或 Excel 表格，并在写入前预览重复项、已有牌和 Scryfall 核验结果
- 读取 Scryfall 的美元价格，按 Foil / Non-Foil 状态显示单牌与总价，并每日批量刷新
- 导出可重新导入的 Excel 牌表（含闪卡状态与美元价格）
- 完整 JSON 备份与恢复，保留 Cube 信息、笔记和卡牌状态
- 可切换到文件夹模式，把主数据自动写入项目目录里的 `cube-data.json`
- Cube 名称、简介和设计笔记
- 浏览器本地自动保存
- 删除牌张后可在提示中撤销

## 本地运行

直接打开 `index.html`，或在目录中运行：

```sh
python3 -m http.server 4173
```

然后访问 `http://localhost:4173`。卡图和牌张查找需要联网。

## 存储模式

- 默认保存在当前浏览器的 `localStorage`
- 在支持 File System Access API 的 Chromium 浏览器中，可以选择一个 Cube 文件夹
- 连接文件夹后，应用会继续保留浏览器本地镜像，同时把主数据自动同步到文件夹里的 `cube-data.json`
- 把整个文件夹复制到别的电脑后，重新选择该文件夹即可继续使用

## 测试

```sh
npm test
npm run check
```
