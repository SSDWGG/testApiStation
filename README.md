# TestApiStation

AI 中转站模型真伪检测工具。通过 10 项黑盒探针，从协议、身份、能力、安全、性能五大维度，为 AI API 中转站提供透明、可解释的技术体检。

## 在线地址

**[ssdwgg.github.io/testApiStation](https://ssdwgg.github.io/testApiStation/)**

## 支持的模型

| Claude | GPT |
|--------|-----|
| Opus 4.7 | GPT-5.5 |
| Opus 4.6 | GPT-5.4 |
| Sonnet 4.6 | GPT-5.3-codex |

## 检测能力

10 项黑盒探针，加权置信度评分，6 级判定（正品 → 确认假冒）：

1. 连通性与基础响应
2. 模型自报身份
3. System Prompt 服从性
4. max_tokens 截断行为
5. stop 序列行为
6. 错误响应格式
7. 词汇指纹分析
8. 推理能力基准
9. 响应元数据分析
10. 知识截断日期检测

## 支持协议

- OpenAI Chat Completions
- OpenAI Responses API
- Anthropic Messages API

## 使用方式

1. 输入中转站的 API 端点地址
2. 输入 API Key（建议使用临时 Key）
3. 选择或输入声称的模型名称
4. 选择 API 协议格式
5. 点击「开始检测」

浏览器直连目标 API，**零存储、纯前端、无服务端数据收集**。

## 本地运行

直接浏览器打开 `index.html`，或使用任意静态文件服务器：

```bash
python3 -m http.server 8080
# 然后访问 http://localhost:8080
```
