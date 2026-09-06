(function () {
  const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function monthDays(year, month) {
    const first = new Date(year, month, 1, 12);
    const start = new Date(year, month, 1-first.getDay(), 12);
    const count = Math.ceil((first.getDay()+new Date(year,month+1,0).getDate())/7)*7;
    return Array.from({length:count}, (_,i) => { const d=new Date(start);d.setDate(start.getDate()+i);return {date:key(d),inMonth:d.getMonth()===month}; });
  }
  function timeLabel(time) {
    if (!/^\d{2}:\d{2}$/.test(time||'')) return 'Time TBD';
    const [h,m]=time.split(':').map(Number);
    return h>23||m>59?'Time TBD':`${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
  }
  if (typeof module==='object' && module.exports) {module.exports={monthDays,timeLabel};return;}
  let month=new Date();month=new Date(month.getFullYear(),month.getMonth(),1,12);
  let selected='';let view='calendar';
  const originalRender=renderSchedule301;
  renderSchedule301=function () {
    originalRender();
    const root=document.getElementById('scheduleCards301');if(!root)return;
    const list=root.closest('.schedule-301-list');
    list.closest('.schedule-301-grid').classList.add('schedule418');
    let panel=document.getElementById('scheduleCalendar418');
    if(!panel){panel=document.createElement('div');panel.id='scheduleCalendar418';root.before(panel);}
    const e=scheduleEscape301, today=localDate301();
    const all=readSchedule301().sort((a,b)=>(a.date||'').localeCompare(b.date||'')||(a.time||'99:99').localeCompare(b.time||'99:99'));
    const next=all.find(g=>g.date>=today);
    list.querySelector('.schedule-301-filters').hidden=view==='calendar';
    const title=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
    panel.innerHTML=`${next?`<div class="schedule-next418"><span>Next game · ${e(new Date(next.date+'T12:00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}))} · ${e(timeLabel(next.time))}</span><strong>${e(next.homeAway==='Away'?'at':'vs')} ${e(next.opponent)}</strong><span>${e(next.location||'Rink TBD')}</span></div>`:''}
      <div class="schedule-nav418"><div><button data-view="calendar" aria-pressed="${view==='calendar'}">Calendar</button><button data-view="agenda" aria-pressed="${view==='agenda'}">Game list</button></div>${view==='calendar'?`<div><button data-month="-1" aria-label="Previous month">‹</button><strong>${e(title)}</strong><button data-month="1" aria-label="Next month">›</button><button id="scheduleToday418">Today</button></div>`:''}</div>
      ${view==='calendar'?`<div class="schedule-calendar418">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="schedule-weekday418">${d}</div>`).join('')}${monthDays(month.getFullYear(),month.getMonth()).map(d=>{const games=all.filter(g=>g.date===d.date);return `<button class="schedule-day418 ${d.inMonth?'':'outside'} ${d.date===today?'today':''}" data-date="${d.date}" aria-pressed="${selected===d.date}" aria-label="${d.date}, ${games.length} games"><b>${Number(d.date.slice(-2))}</b>${games.slice(0,2).map(g=>`<span>${e(timeLabel(g.time))}<br>${e(g.homeAway==='Away'?'at':'vs')} ${e(g.opponent)}</span>`).join('')}${games.length>2?`<small>+${games.length-2} more</small>`:''}</button>`;}).join('')}</div><div class="schedule-dayheading418"><strong>${selected?e(new Date(selected+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})):'Games this month'}</strong><div>${selected?'<button id="scheduleShowMonth418">Whole month</button>':''}<button id="scheduleAddDate418">＋ Add game${selected?' on this date':''}</button></div></div>`:''}`;
    if(view==='calendar'){
      const visible=new Set(all.filter(g=>selected?g.date===selected:(g.date||'').slice(0,7)===key(month).slice(0,7)).map(g=>g.id));
      // Render the existing game actions from the complete schedule before narrowing this view.
      const prior=scheduleFilter301;scheduleFilter301='all';originalRender();scheduleFilter301=prior;
      root.querySelectorAll('.schedule-game-301').forEach(row=>{if(!visible.has(row.querySelector('[data-schopen301]')?.dataset.schopen301))row.remove();});
      if(!visible.size)root.innerHTML='<div class="schedule-empty-301">No games scheduled. Use Add game to put one on the calendar.</div>';
    }
    root.querySelectorAll('.schedule-meta-301 span').forEach(s=>{if(s.textContent.startsWith('🕒 '))s.textContent=timeLabel(s.textContent.slice(3));});
    panel.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;renderSchedule301();});
    panel.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+Number(b.dataset.month),1,12);selected='';renderSchedule301();});
    panel.querySelectorAll('[data-date]').forEach(b=>b.onclick=()=>{selected=b.dataset.date;renderSchedule301();});
    const bind=(id,fn)=>{const b=document.getElementById(id);if(b)b.onclick=fn;};
    bind('scheduleToday418',()=>{month=new Date(new Date().getFullYear(),new Date().getMonth(),1,12);selected=today;renderSchedule301();});
    bind('scheduleShowMonth418',()=>{selected='';renderSchedule301();});
    bind('scheduleAddDate418',()=>{clearScheduleForm301();document.getElementById('scheduleDate301').value=selected||key(month);document.getElementById('scheduleForm412').open=true;document.getElementById('scheduleOpponent301').focus();});
  };
  renderSchedule301();
})();
