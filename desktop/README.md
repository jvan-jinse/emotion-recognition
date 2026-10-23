# 心晴伴 Windows 桌面端

该目录提供独立Electron客户端。网页界面由 scripts/build_update.py 生成，scripts/build_desktop.py 复制到本机安全来源，不访问公网网站。

后台记录必须由用户在每次会话主动同意。主窗口隐藏时保留托盘及采集状态提示条。锁屏、休眠、退出、权限中断和心跳异常时暂停，解锁不自动开启。没有系统服务和开机自启。

生产运行默认不会打开摄像头。视频权限仅在用户主动开始后的本机主窗口允许；不允许麦克风。main.cjs 中的IPC只开放指定状态和控制方法，不开放文件读写或任意命令执行。

--test-mode 和 --test-user-data 仅用于模拟画面测试，不是用户安装步骤。Electron运行环境不进源仓库，下载脚本内固定官方版本与SHA-256。请保留运行环境的LICENSE和LICENSES.chromium.html。
