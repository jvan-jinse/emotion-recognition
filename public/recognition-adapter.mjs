import {inspectFace,classify} from './core.mjs';
// The supplied core.mjs is preserved byte for byte. These functions lift the
// supplied app's detector and voting decisions into the new application shell.
export async function detectProvidedFrame(api,pixels,stillCurrent=()=>true){
  let faces=await api.detectAllFaces(pixels,new api.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:.35})).withFaceLandmarks(true).withFaceExpressions();
  const firstValidity=faces.length===1?inspectFace(faces[0],pixels.width,pixels.height):null;
  if(stillCurrent()&&(!faces.length||(faces.length===1&&firstValidity!=='valid'))){
    const alternate=await api.detectAllFaces(pixels,new api.TinyFaceDetectorOptions({inputSize:416,scoreThreshold:.35})).withFaceLandmarks(true).withFaceExpressions();
    if(!faces.length||alternate.length>faces.length||(alternate.length===1&&faces.length===1&&alternate[0].detection.score>faces[0].detection.score))faces=alternate;
  }
  return faces;
}
export function decideExpression(scores,vote=null,threshold=.60){
  const current=classify(scores,threshold);let decision=current;
  if(vote&&vote.samples>=3&&vote.ratio>=.6){const voted=classify(vote.average,threshold);if(voted.accepted&&voted.key===vote.key)decision={...voted,vote};}
  return decision;
}
export function providedFrameSize(width,height){const scale=Math.min(1,640/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
