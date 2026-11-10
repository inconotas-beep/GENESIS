/* A domain-shaped email alone does not confirm a migrated institutional account. */
var GoogleAccounts=(()=>{
 function confirmed(user){const identity=user?.googleIdentity;return identity?.status==='CONFIRMED'&&identity.email===String(user.email).trim().toLowerCase()&&GoogleConfig.domainEmail(user.email);}
 function authenticate(db,email){
  const user=db.users.find(u=>u.active&&['ADMIN','TEACHER','DIRECTION'].includes(u.role)&&String(u.email).toLowerCase()===email&&confirmed(u));
  if(!user)throw publicError_('Acceso denegado: cuenta no confirmada, inactiva o no registrada. Contactá con administración');
  return user;
 }
 function mark(user,email,actorId,isConfirmed){
  const originalEmail=user.googleIdentity?.originalEmail||user.email;
  if(isConfirmed)user.email=email;
  user.googleIdentity={status:isConfirmed?'CONFIRMED':'PENDING',email:isConfirmed?email:'',originalEmail,confirmedBy:isConfirmed?actorId:null,confirmedAt:isConfirmed?new Date().toISOString():null};
 }
 return {confirmed,authenticate,mark};
})();
