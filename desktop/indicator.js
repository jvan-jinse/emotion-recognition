document.getElementById('pause').onclick=()=>window.captureIndicator.pause();
document.getElementById('show').onclick=()=>window.captureIndicator.show();
window.captureIndicator.onStatus(s=>{document.getElementById('state').textContent=s.running?'摄像头记录中':'摄像头已暂停';const seconds=Math.floor(s.activeMs/1000);document.getElementById('time').textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')+' · 仅本机处理'});
