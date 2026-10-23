"""Assemble a portable Windows client from a verified official runtime."""
from pathlib import Path
import json, shutil
root=Path(__file__).resolve().parents[1]
runtime=root.parent/'desktop-runtime/electron-win32-x64'
if not (runtime/'electron.exe').exists():raise SystemExit('Run scripts/download_desktop_runtime.py first')
output=root.parent/'windows-v6/心晴伴_Windows'
output.mkdir(parents=True,exist_ok=True)
shutil.copytree(runtime,output,dirs_exist_ok=True)
app=output/'resources/app';app.mkdir(parents=True,exist_ok=True)
for file in (root/'desktop').iterdir():
    if file.is_file():shutil.copyfile(file,app/file.name)
shutil.copytree(root/'dist',app/'web',dirs_exist_ok=True)
# Keep a development copy for automated native-process verification.
shutil.copytree(root/'dist',root/'desktop/web',dirs_exist_ok=True)
shutil.copyfile(root/'THIRD_PARTY_NOTICES.md',app/'THIRD_PARTY_NOTICES.md')
shutil.copyfile(root/'应用场景与研究依据.md',app/'应用场景与研究依据.md')
if (output/'electron.exe').exists():(output/'electron.exe').replace(output/'心晴伴.exe')
(output/'使用说明.txt').write_text('''心晴伴 Windows 桌面版 v6

请完整解压整个文件夹，然后双击“心晴伴.exe”。不要只取出 exe。
无需打开网站，也无需安装 Python 或 Node。首次打开不会自动开启摄像头。

1. 进入实时监测，确认本人同意后开启摄像头。
2. 若希望窗口收起后继续，勾选“允许这次记录在桌面程序收起后继续”。
3. 点击“收起到后台”，或在采集中关闭主窗口。程序会留在托盘，并显示采集提示条。
4. 可以在提示条或托盘右键菜单暂停、打开界面或停止并退出。

锁屏、休眠、关闭程序、关闭摄像头权限或硬件被占用时会停止或暂停，返回后需手动继续。不自动开机启动。
用户设定的记录时长到达后结束本次记录。可选择25分钟、45分钟、2小时或8小时。
系统托盘可能位于任务栏折叠菜单中，采集中另有可见提示条。

数据只保存在本机，未加密。桌面版与网站的记录各自独立，不自动同步。
不保存原始视频或照片，不录音。症状自查使用本人回答，不由摄像头代答，不提供疾病确诊或患病概率。
这是未签名的竞赛原型，尚未完成真实摄像头长期测试或临床有效性验证。
''',encoding='utf-8')
print('PASS Windows portable app assembled:',output)
