# Code runner

This package is the Phase 5 CP execution boundary. It submits only allowlisted languages and curated test cases to a self-hosted Judge0 CE instance. The adapter uses the documented asynchronous submission flow (`POST /submissions`, then `GET /submissions/:token`) because the official service does not enable `wait=true` by default.

The VPS must run Judge0 CE with its worker container isolated from the public network and with cgroup CPU, memory, wall-clock, process, and file-size limits. `enable_network: false` is sent on every submission, but host firewall and Docker configuration remain required operational controls. Keep the base URL HTTPS and set any API key through the deployment secret store.

The queue is intentionally bounded and grades each test case server-side by normalized stdout. Client-sent scores and token rewards are not accepted. `sanitizeFeedback` wraps source and runtime output as untrusted data before any optional AI feedback call.
