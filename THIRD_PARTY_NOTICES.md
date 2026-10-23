# Third-party notices

QaLi's project-specific simulator, tests, scripts, and documentation were developed with AI assistance. They are distributed under the root MIT license. Upstream software retains its own license and authorship.

## Microsoft create-playwright

Initial scaffolding was generated with `create-playwright@1.17.139` and then adapted for QaLi. Source: https://github.com/microsoft/create-playwright. Microsoft licenses that starter under MIT:

> MIT License
>
> Copyright (c) Microsoft Corporation.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Playwright

The toolkit uses `@playwright/test@1.64.1` and Playwright Chromium automation. The Playwright engine is upstream work. QaLi adds its own declarative plan runner, CLI, reports, and bundled workflow skills; it does not claim to have created Playwright.

Source: https://github.com/microsoft/playwright. License: [Apache License 2.0](docs/licenses/Playwright-APACHE-2.0.txt), with the upstream [NOTICE](docs/licenses/Playwright-NOTICE.txt).

Other installed dependencies retain their package licenses. Exact versions and integrity hashes are recorded in `package-lock.json`; dependency and browser binaries are not distributed in this source repository.
