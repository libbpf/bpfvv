[![CI](https://github.com/libbpf/bpfvv/actions/workflows/ci.yml/badge.svg)](https://github.com/libbpf/bpfvv/actions/workflows/ci.yml)

**bpfvv** stands for BPF Verifier Visualizer

https://libbpf.github.io/bpfvv/

BPF Verifier Visualizer is a tool for analysis of Linux Kernel BPF verifier log.

The tools aims to help BPF programmers with debugging verification failures.

The user can load a text file, and the app will attempt to parse it as a verifier log. Successfully parsed lines produce a state which is then visualized in the UI. You can think of this as a primitive debugger UI, except it interprets a log and not a runtime state of a program.

For more information on how to use **bpfvv** see the [HOWTO.md](https://github.com/libbpf/bpfvv/blob/master/HOWTO.md)

## Development

- Fork the website repo: https://github.com/libbpf/bpfvv.git

- Clone your fork:
    - `git clone https://github.com/<username>/bpfvv.git`

- Setup node modules:
	- `npm install`

- Develop the app:
	- `npm start`

- Build the app for static testing:
	- `npm run build`

- Serve the statically built app:
	- `npm run serve`

- Format your code:
	- `npm run format`

- To run lint, typecheck, and tests:
	- `npm run check`

- If everything is OK, push your branch, create a PR.

---

This is a self-contained web app that runs entirely on the client side. There is no backend server. Once loaded, it operates within the browser.

* To learn more about BPF visit https://ebpf.io/
* See also: https://github.com/eddyz87/log2dot
