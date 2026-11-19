import {spawn} from 'node:child_process';
// The installed Codex app-server protocol supplies real answer deltas and tool events.
// Pin the reserved built-in OpenAI provider; refuse API-key accounts before starting a turn.
export function runAgent({bin,root,model,prompt,images=[],onEvent=()=>{},signal}){
 return new Promise((resolve,reject)=>{
  const env={...process.env};delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
  const p=spawn(bin,['app-server','--stdio','-c','forced_login_method="chatgpt"','-c','model_provider="openai"'],{env,stdio:['pipe','pipe','pipe']});
  let buffer='',err='',done=false,threadId,turnId,killTimer;const messages=new Map();
  const answer=()=>[...messages.values()].filter(m=>m.phase!=='commentary').map(m=>m.text).join('\n\n');
  const send=x=>{if(!p.stdin.destroyed)p.stdin.write(JSON.stringify(x)+'\n')};
  function finish(error){if(done)return;done=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',stop);p.kill('SIGTERM');error?reject(error):resolve(answer())}
  function stop(){if(threadId&&turnId)send({id:90,method:'turn/interrupt',params:{threadId,turnId}});killTimer=setTimeout(()=>{p.kill('SIGKILL');finish(new Error('已停止生成'))},1500);if(!threadId)finish(new Error('已停止生成'))}
  const timer=setTimeout(()=>{p.kill('SIGKILL');finish(new Error('生成超时，请重试'))},600000);signal?.addEventListener('abort',stop,{once:true});
  function update(item){if(item?.type==='agentMessage'){messages.set(item.id,{text:item.text||'',phase:item.phase});if(item.phase==='commentary')onEvent({progress:(item.text||'正在处理').slice(0,160)});else onEvent({answer:answer(),progress:'正在回答'})}else if(item?.type==='commandExecution'){const cmd=item.command||'';let label=/pdf-tool.*render/.test(cmd)?'正在查看课件图像':/pdf-tool/.test(cmd)?'正在读取课件':/rg |find |ls /.test(cmd)?'正在搜索课程文件夹':'正在使用课程工具';const page=cmd.match(/pdf-tool.*?\s(\d+)(?:\s|$)/);if(page)label+=' · 第 '+page[1]+' 页';onEvent({progress:label})}else if(item?.type==='reasoning')onEvent({progress:'正在思考'})}
  function handle(m){if(done)return;if(m.error&&[1,2,3,4].includes(m.id))return finish(new Error(m.error.message));
   if(m.id===1){send({method:'initialized'});send({id:2,method:'account/read',params:{refreshToken:false}})}
   if(m.id===2){if(m.result?.account?.type!=='chatgpt')return finish(new Error('请用ChatGPT账号登录，本应用不使用API key'));send({id:3,method:'thread/start',params:{...(model?{model}:{}),modelProvider:'openai',cwd:root,approvalPolicy:'never',sandbox:'workspace-write',ephemeral:true,config:{forced_login_method:'chatgpt'}}})}
   if(m.id===3){threadId=m.result.thread.id;if(signal?.aborted)return stop();send({id:4,method:'turn/start',params:{threadId,input:[{type:'text',text:prompt,text_elements:[]},...images.map(path=>({type:'localImage',path}))]}})}
   if(m.id===4){turnId=m.result.turn.id;if(signal?.aborted)stop()}
   if(m.method==='item/started'||m.method==='item/completed')update(m.params?.item);
   if(m.method==='item/agentMessage/delta'){const q=m.params,old=messages.get(q.itemId)||{text:'',phase:null};old.text+=q.delta;messages.set(q.itemId,old);if(old.phase==='commentary')onEvent({progress:old.text.slice(0,160)});else onEvent({answer:answer(),progress:'正在回答'})}
   if(m.method==='turn/completed'){const t=m.params.turn;for(const item of t.items||[])if(item.type==='agentMessage')update(item);if(signal?.aborted||t.status==='interrupted')return finish(new Error('已停止生成'));if(t.status==='failed')return finish(new Error(t.error?.message||'生成失败'));finish(answer()?null:new Error('未收到回答，请重试'))}
   // No escalation is granted by this app. Workspace tools continue under the configured policy.
   if(m.id!=null&&m.method){if(m.method.endsWith('requestApproval'))send({id:m.id,result:{decision:'decline'}});else send({id:m.id,error:{code:-32601,message:'此操作需要用户在应用内明确处理'}})}
  }
  p.stdout.on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{handle(JSON.parse(line))}catch(e){finish(e)}}});p.stderr.on('data',c=>err=(err+c).slice(-2500));p.stdin.on('error',()=>{});p.on('error',finish);p.on('close',()=>{if(!done)finish(new Error(signal?.aborted?'已停止生成':err||'模型连接中断'))});
  send({id:1,method:'initialize',params:{clientInfo:{name:'dsh-sidequest',version:'0.4.0'},capabilities:{experimentalApi:true}}});if(signal?.aborted)stop();
 });
}
