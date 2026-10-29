import {requireOwnerContext} from '@/lib/authz';
import {paymentFlowEnabled,squareConfig,squareRequest,squareSiteUrl} from '@/lib/square-client';

export const dynamic='force-dynamic';
const headers={'cache-control':'no-store'};
type CatalogObject={id:string;type:string;is_deleted?:boolean;item_variation_data?:{price_money?:{amount?:number;currency?:string}};
  subscription_plan_variation_data?:{phases?:Array<{cadence?:string;pricing?:{type?:string;price_money?:{amount?:number;currency?:string}}}>}};

/** Read-only owner preflight. No customers, orders, invoices, subscriptions or charges are created. */
export async function GET(){
  const context=await requireOwnerContext();
  if(!context.ok)return context.response;
  try{
    const config=squareConfig();
    const {data:classes,error:classError}=await context.admin.from('classes').select('id,price_cents')
      .eq('status','scheduled').gt('start_time',new Date().toISOString());
    const {data:mappings,error:mappingError}=await context.admin.from('square_catalog_mappings')
      .select('entity_key,variation_id,program_key').eq('environment',config.environment).eq('kind','class');
    if(classError||mappingError)throw new Error('Apply the payment and class program migrations before opening payments');
    const partyId=process.env.SQUARE_PARTY_ITEM_VARIATION_ID,planId=process.env.SQUARE_PLAN_VARIATION_ID;
    const objectIds=[...new Set([partyId,planId,...(mappings??[]).map(m=>m.variation_id)].filter((id):id is string=>Boolean(id)))];
    const [{location},{objects},{subscriptions}]=await Promise.all([
      squareRequest<{location:{id:string;status?:string;currency?:string;capabilities?:string[]}}>('/v2/locations/'+encodeURIComponent(config.locationId)),
      squareRequest<{objects?:CatalogObject[]}>('/v2/catalog/batch-retrieve','POST',{object_ids:objectIds}),
      squareRequest<{subscriptions?:Array<{enabled:boolean;notification_url:string;signature_key?:string;event_types:string[];api_version:string}>}>('/v2/webhooks/subscriptions'),
    ]);
    const catalog=new Map((objects??[]).map(object=>[object.id,object]));
    const priced=(id:string|undefined,amount:number)=>{const object=id?catalog.get(id):undefined;return Boolean(object&&!object.is_deleted&&object.type==='ITEM_VARIATION'&&object.item_variation_data?.price_money?.currency==='USD'&&object.item_variation_data.price_money.amount===amount);};
    const phases=(planId?catalog.get(planId):undefined)?.subscription_plan_variation_data?.phases??[];
    const requiredEvents=['invoice.created','invoice.published','invoice.updated','invoice.payment_made','invoice.canceled','invoice.refunded','invoice.scheduled_charge_failed','payment.created','payment.updated','refund.created','refund.updated','order.updated','subscription.created','subscription.updated'];
    const webhook=(subscriptions??[]).find(item=>item.notification_url===process.env.SQUARE_WEBHOOK_URL);
    const checks={
      location:location.id===config.locationId&&location.status==='ACTIVE'&&location.currency==='USD'&&Boolean(location.capabilities?.includes('CREDIT_CARD_PROCESSING')),
      party_catalog:priced(partyId,30000),
      membership_catalog:Boolean(planId&&catalog.get(planId)?.type==='SUBSCRIPTION_PLAN_VARIATION'&&!catalog.get(planId)?.is_deleted&&phases.length===1&&phases[0].cadence==='MONTHLY'&&phases[0].pricing?.type==='STATIC'&&phases[0].pricing.price_money?.currency==='USD'&&phases[0].pricing.price_money.amount===6000),
      class_catalog:(classes??[]).every(c=>priced((mappings??[]).find(m=>m.entity_key===c.id)?.variation_id,c.price_cents)),
      webhook_configured:Boolean(webhook&&process.env.SQUARE_WEBHOOK_SIGNATURE_KEY&&webhook.signature_key===process.env.SQUARE_WEBHOOK_SIGNATURE_KEY&&webhook.api_version===config.version&&requiredEvents.every(event=>webhook.event_types.includes(event))&&process.env.SQUARE_WEBHOOK_URL===`${squareSiteUrl()}/api/webhooks/square`),
      email_configured:Boolean(process.env.RESEND_API_KEY&&process.env.RESEND_FROM_EMAIL),
      cron_configured:Boolean(process.env.CRON_SECRET||process.env.PARTY_REMINDER_SECRET),
    };
    return Response.json({ok:true,environment:config.environment,api_version:config.version,checks,
      configuration_ready:Object.values(checks).every(Boolean),webhook_enabled:webhook?.enabled??false,
      flags:{party:paymentFlowEnabled('party'),class:paymentFlowEnabled('class'),membership:paymentFlowEnabled('membership')},
      scheduled_class_count:classes?.length??0}, {headers});
  }catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:'Square preflight failed'},{status:409,headers});}
}
