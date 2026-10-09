export async function requestReceiptRefund(input:{receiptId:string;reason:string;itemIds:string[];allocationAmounts:Record<string,string>;operationId:string}){
 const response=await fetch('/api/workspace/refunds',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',...input})});
 const data=await response.json();if(!response.ok)throw Error(data.error||'Could not request refund.');return data;
}
