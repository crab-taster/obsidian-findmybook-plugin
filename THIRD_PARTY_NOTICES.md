# 第三方组件声明 / Third-Party Notices

本插件以闭源方式分发（见 `LICENSE`），但其构建产物 `main.js` 中打包了以下第三方开源组件。
这些组件不受本插件专有许可约束，仍适用其各自许可；本文件保留其要求的版权与许可声明。

## qrcode

- 版本：1.5.4（npm 包 `qrcode`）
- 许可证：MIT
- 项目地址：<https://github.com/soldair/node-qrcode>

```
The MIT License (MIT)

Copyright (c) 2012 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

同一份 MIT 声明也内嵌在 `main.js` 顶部的注释里（由 `esbuild.config.mjs` 的 `banner` 注入），
确保用户拿到构建产物时能同时拿到声明。
