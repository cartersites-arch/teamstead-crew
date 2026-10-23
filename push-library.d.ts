declare module 'web-push/src/encryption-helper.js' {
 const encryption:{encrypt:(key:string,auth:string,payload:string,encoding:string)=>{cipherText:Uint8Array}};
 export default encryption;
}
