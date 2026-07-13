# FCA 4 Foil Effects Reference

这是 Arcana Cube 的 Foil 视觉备用区。页面使用同一张 `FCA #4 Counterspell` 展示 22 种可交互材质，用于以后选择、组合和重新实现大图 Foil 效果；它不参与正式应用运行。

## 打开方式

从项目根目录启动现有服务器：

```sh
npm run serve
```

然后打开：

```text
http://127.0.0.1:4173/prototypes/foil-effects-22/
```

也可以在本目录单独启动静态服务器：

```sh
python3 -m http.server 4184 --bind 127.0.0.1
```

页面默认同步移动 22 张卡的光源。鼠标移入单张卡后，该卡会改为独立响应；右上角按钮可切换同步巡光和静止比较。

## 保存内容

- `index.html`：22 种效果的加载顺序和页面结构
- `preview.js`：效果属性映射、同步巡光和鼠标交互
- `preview.css`：仅供对比页使用的布局与外观
- `css/cards/`：22 种材质规则和共享基础层
- `img/`：材质、颗粒、闪粉和 Cosmos 纹理
- `images/fca-4-counterspell.png`：统一使用的本地高清测试卡图

## 来源与许可

材质 CSS 和纹理资源来自 [simeydotme/pokemon-cards-css](https://github.com/simeydotme/pokemon-cards-css)，保存时对应提交：

```text
acb1197633e749a1fba4412231db2f6581586d00
```

上游项目使用 GPL-3.0，完整许可见 `LICENSE.pokemon-cards-css.txt`。本目录是隔离的研究原型；未来集成到正式 Cube 前，应依据这些视觉原理重新实现或单独确认许可证影响，不要直接把上游 CSS 无说明地复制到生产样式中。

## 已验证状态

2026-07-13 在 Chrome 中验证：22 个效果条目和 22 张卡图全部加载，同步巡光正常，控制台无资源或脚本错误。
