(function(){
  function report(message){
    var state=document.documentElement.getAttribute('data-model-state');
    if(state==='idle')return;
    if(state==='ready'||state==='failed')return;
    var notice=document.getElementById('notice');
    if(notice){notice.textContent=message;notice.classList.add('error');}
  }
  window.addEventListener('error',function(event){
    if(event.target&&event.target.tagName==='SCRIPT')report('页面脚本加载失败。请刷新页面，或检查是否已完整上传新版部署包。');
    else report('页面初始化失败。请刷新页面，或把错误提示发给网站维护者。');
  },true);
  window.addEventListener('unhandledrejection',function(){report('模型或脚本初始化失败，请刷新页面后重试。');});
  document.addEventListener('DOMContentLoaded',function(){setTimeout(function(){if(document.documentElement.getAttribute('data-app-state')!=='ready')report('页面未能启动。请刷新页面，或确认已完整上传部署文件。');},12000);});
})();
