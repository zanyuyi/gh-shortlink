#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);

const DEFAULT_FILE=path.resolve(__dirname,'../assets/mappings.json');
const base62='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const base62Safe='23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
const CONFIG={CODE_MIN_LEN:5,CODE_MAX_LEN:10,AVOID_AMBIGUOUS:true};

function randCode(len,safe){
  const chars=safe?base62Safe:base62;
  let s='';
  for(let i=0;i<len;i++) s+=chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function parseArgs(argv){
  const [nodePath,scriptPath,cmd,...rest]=argv;
  const opts={cmd:cmd||'help'};
  for(let i=0;i<rest.length;i++){
    const token=rest[i];
    if(!token.startsWith('--')) continue;
    const key=token.slice(2);
    const next=rest[i+1];
    if(next && !next.startsWith('--')){
      opts[key]=next;
      i++;
    }else{
      opts[key]=true;
    }
  }
  return opts;
}

async function loadMappings(file){
  if(!existsSync(file)) return [];
  const raw=await readFile(file,'utf8');
  if(!raw.trim()) return [];
  try{
    const data=JSON.parse(raw);
    if(Array.isArray(data)) return data;
    throw new Error('mappings.json 必须是数组');
  }catch(err){
    throw new Error(`无法解析 ${file}: ${err.message}`);
  }
}

async function saveMappings(file,data){
  const json=JSON.stringify(data,null,2)+"\n";
  await writeFile(file,json,'utf8');
}

function ensureUnique(code,data){
  if(data.some(item=>item.code===code)){
    throw new Error(`短码 ${code} 已存在，如需覆盖请使用 --replace`);
  }
}

function hashPassword(pwd){
  if(!pwd) return null;
  return crypto.createHash('sha256').update(pwd).digest('hex');
}

function parseLocales(input){
  const map={};
  if(!input) return map;
  for(const pair of input.split(',')){
    const [lang,...urlParts]=pair.split('=');
    if(!lang || urlParts.length===0) continue;
    const url=urlParts.join('=');
    map[lang.trim()]=url.trim();
  }
  return map;
}

function isValidUrl(u){
  try{
    new URL(u);
    return true;
  }catch{
    return false;
  }
}

function getRandomCode(existing){
  const length=Math.max(CONFIG.CODE_MIN_LEN,4);
  let code='';
  const used=new Set(existing.map(item=>item.code));
  for(let i=0;i<10000;i++){
    code=randCode(length,CONFIG.AVOID_AMBIGUOUS);
    if(!used.has(code)) return code;
  }
  throw new Error('无法生成唯一短码，请手动指定 --code');
}

function printHelp(){
  console.log(`短链命令行工具\n\n用法：\n  node tools/shortlink-cli.mjs <命令> [选项]\n\n命令：\n  add        新增短链映射\n  remove     删除指定短码\n  list       查看全部短码\n  help       显示本帮助\n\n常用选项：\n  --file <路径>         指定 mappings.json，默认 assets/mappings.json\n  --code <短码>         自定义短码，留空则随机生成\n  --url <URL>          目标链接（add 命令必填）\n  --expires <时间>     ISO8601 过期时间\n  --password <密码>    访问密码，写入为 SHA-256 哈希\n  --mobile <URL>       移动端重定向\n  --desktop <URL>      桌面端重定向\n  --locale <a=b,...>   按语言重定向，如 zh-CN=https://example.com\n  --replace            允许覆盖已存在短码\n`);
}

async function main(){
  const opts=parseArgs(process.argv);
  const file=opts.file?path.resolve(opts.file):DEFAULT_FILE;
  const data=await loadMappings(file);

  switch(opts.cmd){
    case 'add':{
      const url=opts.url;
      if(!url) throw new Error('add 命令必须提供 --url');
      if(!isValidUrl(url)) throw new Error('URL 非法，请包含协议，如 https://example.com');
      let code=opts.code||'';
      if(code){
        if(!/^[0-9A-Za-z_-]+$/.test(code)) throw new Error('短码仅允许数字、字母、下划线、连字符');
        if(!opts.replace) ensureUnique(code,data);
      }else{
        code=getRandomCode(data);
      }
      const now=new Date().toISOString();
      const mapping={
        code,
        url,
        createdAt:now,
        expiresAt:opts.expires?opts.expires:null,
        passwordHash:hashPassword(opts.password),
        targets:{
          device:{
            mobile:opts.mobile||null,
            desktop:opts.desktop||null
          },
          locale:parseLocales(opts.locale)
        }
      };
      if(opts.replace){
        const idx=data.findIndex(item=>item.code===code);
        if(idx>=0) data[idx]=mapping; else data.push(mapping);
      }else{
        data.push(mapping);
      }
      await saveMappings(file,data);
      console.log(`已写入 ${code} -> ${url}`);
      break;
    }
    case 'remove':{
      const code=opts.code;
      if(!code) throw new Error('remove 命令必须提供 --code');
      const before=data.length;
      const filtered=data.filter(item=>item.code!==code);
      if(filtered.length===before){
        console.error(`未找到短码 ${code}`);
      }else{
        await saveMappings(file,filtered);
        console.log(`已删除 ${code}`);
      }
      break;
    }
    case 'list':{
      if(data.length===0){
        console.log('暂无短链');
        break;
      }
      const rows=data.map(item=>`${item.code.padEnd(12)} ${item.url}`);
      console.log(rows.join('\n'));
      break;
    }
    default:
      printHelp();
  }
}

main().catch(err=>{
  console.error(err.message||err);
  process.exitCode=1;
});
