import { extractTime } from './_slot-parsers';
import { ORGANIZATION_CONFIG } from './_organization-config';
import type { VisitorInformationAnswer } from './_visitor-information';

export function regularArrivalInformation(message:string):VisitorInformationAnswer|null {
  if(!/ไปถึง|ไปตอน|ถึงตอน|เข้าไปตอน|มาถึง|^แล้ว.*(?:โมง|ทุ่ม|[0-9]:)/u.test(message)
      || !/ทัน|ได้ไหม|ได้มั้ย|เปิด|ปิด|ล่ะ/u.test(message)
      || /ร้านอาหาร|ตำมา-ชาติ|ที่พัก|เฮือน|กิจกรรม|ขี่ม้า|ATV|ยิงธนู|วันหยุด|สงกรานต์|ปีใหม่|พรุ่งนี้|วันนี้/u.test(message))return null;
  const words:Record<string,number>={หนึ่ง:1,สอง:2,สาม:3,สี่:4,ห้า:5,หก:6};
  const evening=message.match(/(หนึ่ง|สอง|สาม|สี่|ห้า|หก|[1-6])\s*โมงเย็น/u);
  const hourValue=evening?(words[evening[1]] ?? Number(evening[1]))+12:null;
  const time=hourValue!==null?`${hourValue}:00`:extractTime(message);if(!time || !/^\d{2}:\d{2}$/u.test(time))return null;
  const [hour,minute]=time.split(':').map(Number);const arrival=hour*60+minute;
  if(hour>23 || minute>59)return null;
  const hours=ORGANIZATION_CONFIG.regularOpeningHours[0];
  const number=(value:string)=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
  const opens=number(hours.opens),closes=number(hours.closes);
  const timing=arrival<opens?'ยังไม่ถึงเวลาเปิดตามเวลาปกติ':arrival>=closes?'ถึงเวลาปิดหรือเลยเวลาปิดตามเวลาปกติแล้ว':'ยังอยู่ในเวลาทำการปกติ';
  return {topic:'overview',domain:'ecosystem',message:`ถ้ามาถึง ${time} น. ${timing}ครับ ทำมา-ชาติเปิดตามเวลาปกติทุกวัน ${hours.opens}–${hours.closes} น.\nนี่เป็นเวลารวมของพื้นที่ ส่วนร้านและกิจกรรมแต่ละส่วนหรือวันพิเศษควรเช็กอีกครั้งครับ`,sourceIds:[ORGANIZATION_CONFIG.sourceId],usedFactKeys:['organization:regularOpeningHours'],missingFields:[]};
}
