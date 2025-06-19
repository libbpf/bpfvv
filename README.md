> [!WARNING]
> The bpfvv app is in early stages of development, and you should expect
> bugs, UI inconveniences and significant changes from week to week.
>
> If you're working with BPF and you think this tool (or a better
> version of it) would be useful, feel free to use it and don't be shy
> to report issues and request features via github. Thanks!

[![CI](https://github.com/libbpf/bpfvv/actions/workflows/ci.yml/badge.svg)](https://github.com/libbpf/bpfvv/actions/workflows/ci.yml)

**bpfvv** stands for BPF Verifier Visualizer

https://libbpf.github.io/bpfvv/

This project is an experiment about visualizing Linux Kernel BPF verifier log to help BPF programmers with debugging verification failures. 

The user can load a text file, and the app will attempt to parse it as a verifier log. Successfully parsed lines produce a state which is then visualized in the UI. You can think of this as a primitive debugger UI, except it interprets a log and not a runtime state of a program.

---

This is a self-contained web app that runs entirely on the client side. There is no backend server. Once loaded, it operates within the browser.

* To learn more about BPF visit https://ebpf.io/
* See also: https://github.com/eddyz87/log2dot

