# Third-party notices

The all-in-one JavaScript bundle includes or derives from the following
third-party software. These notices do not change the licence of Pi Sparkles.

| Component | Version | Licence | Project |
| --- | --- | --- | --- |
| PDF.js (`pdfjs-dist`) | 6.2.108 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| `@napi-rs/canvas` | 1.0.3 | MIT | https://github.com/Brooooooklyn/canvas |
| Gleam standard library | 1.0.3 and 1.0.5 | Apache-2.0 | https://github.com/gleam-lang/stdlib |
| Gleam JSON | 3.1.0 | Apache-2.0 | https://github.com/gleam-lang/json |
| Gleam JavaScript | 1.0.1 | Apache-2.0 | https://github.com/gleam-lang/javascript |
| Zod | 4.4.3 | MIT | https://github.com/colinhacks/zod |

The complete Apache License, Version 2.0 is distributed in `LICENSE`.
`pdfjs-dist` remains an exact runtime dependency because the PDF text path
resolves packaged CMap assets from it. Its optional `@napi-rs/canvas` polyfill
is pinned explicitly for Bun compatibility. Both load only when a PDF tool is
invoked. Pi host packages are not bundled into the npm tarball.

## @napi-rs/canvas MIT licence

Copyright (c) 2020 lynweklm@gmail.com

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Zod MIT licence

Copyright (c) 2025 Colin McDonnell

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
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
