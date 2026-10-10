# Citation Counts for Zotero

为 Zotero 8 / 9 / 10 获取文献引用数，数据来自 **OpenAlex** 和 **Semantic Scholar**，以可排序的列显示，同时写入条目的“其他”(Extra) 字段以便同步和导出。

不抓取 Google Scholar，因此不会遇到验证码或封锁问题。

## 安装

1. 在 [Releases](../../releases/latest) 下载最新的 `.xpi` 文件。
2. Zotero → 工具 → 插件 → 右上角齿轮 → 从文件安装插件…，选择该 `.xpi`。
3. 之后的新版本会通过 Zotero 自动更新。

## 设置

Zotero → 设置 → **Citation Counts**：

| 选项 | 说明 |
| --- | --- |
| OpenAlex API key | **强烈建议填写**。自 2026 年 2 月起 OpenAlex 需要 API key，免费注册后在 openalex.org → Settings → API 复制。不填只有很小的每日额度。 |
| Semantic Scholar API key | 可选。不填时插件会主动放慢请求速度。 |
| 联系邮箱 | 可选，作为 `mailto` 发送给 OpenAlex。 |
| 按标题匹配 | 对没有 DOI / arXiv ID 的条目，按标题精确匹配（并核对年份）。 |
| 新条目自动获取 | 添加新条目约 15 秒后自动获取；一次添加超过 50 条（如批量导入、同步）时跳过。 |
| 过期天数 | “更新过期的引用数”只刷新超过该天数的条目。 |

## 使用

- **右键条目** → 更新引用数 / 更新过期的引用数 / 移除引用数
- **右键分类、文库或保存的搜索** → 更新引用数
- **显示列**：右键条目列表表头，勾选 “Cites (OpenAlex)” 和 “Cites (S2)”，点击列头即可排序。
- 更新过程中可右键选择“停止更新引用数”。
- Zotero 10 中，每次更新都可以用“编辑 → 撤销”整体撤回。

引用数在 Extra 中的格式：

```
Citations (OpenAlex): 123 [2026-10-10]
Citations (Semantic Scholar): 118 [2026-10-10]
```

插件只会改动这两行，Extra 中的其他内容保持不变。

## 匹配规则

1. DOI（DOI 字段 → Extra 中的 `DOI:` 行 → doi.org 链接）
2. arXiv ID（arxiv.org 链接、Extra 中的 `arXiv:` 行或 arXiv DOI），用于 Semantic Scholar
3. 标题精确匹配（忽略大小写、标点和变音符号，年份相差不超过 1 年）

不同数据源的引用数本来就不同（覆盖范围和去重方式不同），通常都低于 Google Scholar。

## 开发

```bash
npm install
npm test        # 单元测试 + 在模拟 Zotero 环境中启动插件
npm run lint
npm run build   # 生成 build/*.xpi 和 build/update.json
```

维护说明见 [MAINTAINING.md](MAINTAINING.md)。

## 许可

MIT
