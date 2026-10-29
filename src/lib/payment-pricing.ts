export type EnrolledChild = {id:string;birthdate:string};
export function addMonths(date:string,months:number){
  const [y,m,d]=date.split('-').map(Number);
  const last=new Date(Date.UTC(y,m-1+months+1,0)).getUTCDate();
  return new Date(Date.UTC(y,m-1+months,Math.min(d,last))).toISOString().slice(0,10);
}
export function membershipPrice(children:EnrolledChild[],date:string){
  if(!children.length||children.some(c=>!/^\d{4}-\d{2}-\d{2}$/.test(c.birthdate)||c.birthdate>date))throw new Error('Add valid child birthdays in My Info/People first');
  const count=children.filter(c=>addMonths(c.birthdate,6)<=date).length;
  if(!count)throw new Error('An infant can only be added to an older sibling membership');
  return 6000+Math.max(count-1,0)*2000;
}
export type AdmissionPerson={id:string;role:string;birthdate:string|null};
export function admissionPrice(people:AdmissionPerson[],date:string,covered:string[]=[]){
  if(!people.some(p=>p.role==='child')||!people.some(p=>p.role==='adult'))throw new Error('Choose children and an accompanying adult');
  const children=people.filter(p=>p.role==='child'&&!covered.includes(p.id)).sort((a,b)=>(a.birthdate??'').localeCompare(b.birthdate??''));
  if(children.some(p=>!p.birthdate||p.birthdate>date))throw new Error('Add valid child birthdays first');
  return (children.length?(addMonths(children[0].birthdate!,6)<=date?1600:1000)+(children.length-1)*1000:0)
    +Math.max(people.filter(p=>p.role==='adult').length-2,0)*500;
}
