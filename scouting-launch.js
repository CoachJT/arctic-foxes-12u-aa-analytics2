'use strict';
const scoutingLaunch=document.createElement('button');scoutingLaunch.type='button';scoutingLaunch.id='openPrivateScouting';
scoutingLaunch.innerHTML=icon313('scout')+'<span>Private scouting ↗</span>';scoutingLaunch.title='Open password-protected Scouting & Tryouts in a separate window';
scoutingLaunch.onclick=async()=>{try{if(!window.foxesStorage?.openPrivateScouting)throw Error('Restart the updated desktop app to open private scouting.');await window.foxesStorage.openPrivateScouting();}catch(e){alert(e.message);}};
document.querySelector('#workspaceNav').appendChild(scoutingLaunch);
