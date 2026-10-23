# 第三方来源

本项目使用 Vincent Mühler 的 face-api.js 浏览器构建以及同仓库发布的 Tiny Face Detector、Face Expression Net 权重。代码来源为 <https://github.com/justadudewhohacks/face-api.js>，固定提交为 `a86f011d72124e5fb93e59d5c4ab98f699dd5c9c`。MIT 许可证原文见 `THIRD_PARTY_LICENSES/face-api.js-LICENSE`。浏览器构建包含其打包的 TensorFlow.js 相关代码和原有许可证注释，本项目未改写第三方构建文件。

具体下载地址、字节数和 SHA-256 见 `assets.lock.json`。模型训练不是本项目工作，原始数据集的权利不由本项目另行授予。

`tests/fixtures/bbt1.jpg` 来自同一仓库的 `examples/images/bbt1.jpg`，仅作本地功能测试。电视剧画面不属于本项目原创材料。`test-results` 中包含该图片的测试裁剪和截图，不作为竞赛原创成果或精度评测数据。

本次新增face_landmark_68_tiny_model权重与清单来自用户提供的emotion recognition(1).zip，资源校验值已追加到assets.lock.json。新增模型未由本项目训练。

场景版 v3 的成人自查摘自原作者官网中国简体中文版 PHQ-9 与 GAD-7 前两题，保留题目、过去两周时间窗及各自选项。PHQ/GAD 开发者为 Robert L. Spitzer、Kurt Kroenke、Janet B. W. Williams 及同事，开发获 Pfizer 资助。原版文件标注无需许可可复制、翻译、展示或分发。题目来源分别为 https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/PHQ9_Simplified%20Chinese%20for%20Mainland%20China.pdf 和 https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD7_Chinese%20for%20China.pdf 。本项目未声称网页实施方式获得临床认证。

WHO-5 通过 WHO 官方问卷链接提供，不把其文件或完整题目打包重分发。参考与计分来自 WHO 2024 发布页。网页的日记刻度是产品自定义记录项，不是 WHO-5 题目或经验证的新量表。


v4完整PHQ-9采用香港基层医疗署简体中文页面，GAD-7采用国家卫健委WS/T 802—2022表B.3，具体链接见应用设计文档。保留量表作者归属。桌面版基于官方Electron 45.0.0及其随附Chromium运行环境，保留官方运行环境LICENSE和LICENSES.chromium.html，项目未重新编译这些二进制。
