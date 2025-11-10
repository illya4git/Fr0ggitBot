import { Scenes, Markup } from 'telegraf';
import { Op } from 'sequelize';
import { User, Group, UserGroup, Subject, Lesson } from './Models.js';

async function sendMonthCalendar(ctx, baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth(); 
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = firstDay.toLocaleString('uk-UA', { month: 'long' });

  const headerRow = [
    Markup.button.callback('‹', `cal_nav_prev_${year}_${month}`),
    Markup.button.callback(`${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`, 'noop'),
    Markup.button.callback('›', `cal_nav_next_${year}_${month}`)
  ];

  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const weekdayRow = weekdays.map(w => Markup.button.callback(w, 'noop'));
  const firstWeekdayMondayIndex = (firstDay.getDay() + 6) % 7;
  const cells = [];

  for (let i = 0; i < firstWeekdayMondayIndex; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const rows = [];
  rows.push(headerRow);
  rows.push(weekdayRow);

  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const rowButtons = week.map(dt => {
      if (!dt) return Markup.button.callback(' ', 'noop');
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const key = `pickdate_${dt.getFullYear()}-${mm}-${dd}`; // YYYY-MM-DD
      return Markup.button.callback(dd, key);
    });
    while (rowButtons.length < 7) rowButtons.push(Markup.button.callback(' ', 'noop'));
    rows.push(rowButtons);
  }

  rows.push([ Markup.button.callback('Назад', 'back_to_schedule') ]);

  await ctx.reply('Виберіть точну дату:', Markup.inlineKeyboard(rows));
}


// ---------------- scenes ----------------

const GroupSelector = new Scenes.WizardScene(
  'GROUP_SELECTOR',
  async (ctx) => {
    const user = await User.findByPk(ctx.session.user.id, { include: Group });
    const groups = (user && user.Groups) || [];

    await ctx.reply('Оберіть групу:', Markup.inlineKeyboard([
      ...groups.map(group => [ Markup.button.callback(group.name, `group_${group.id}`) ]),
      [ Markup.button.callback('➕ Створити нову', 'new') ],
      [ Markup.button.callback('➡️ Приєднатися', 'join') ]
    ]));
    return ctx.wizard.next();
  },

  async (ctx) => {
    const query = ctx.callbackQuery;
    if (!query) return;

    try {
      await ctx.telegram.answerCbQuery(query.id).catch(()=>{});
      await ctx.telegram.deleteMessage(ctx.session.user.id, ctx.callbackQuery.message.message_id).catch(()=>{});
    } catch (error) { }

    const data = ctx.callbackQuery.data;

    if (data === 'new') {
      await ctx.reply('Як називається ваша група?');
      return ctx.wizard.selectStep(2);
    }
    if (data === 'join') {
      await ctx.reply('Будь ласка, введіть код вашого запрошення.');
      return ctx.wizard.selectStep(3);
    }

    let gid = data;
    if (typeof data === 'string' && data.startsWith('group_')) gid = Number(data.replace('group_',''));
    gid = Number(gid);
    const group = await Group.findByPk(gid);
    if (!group) {
      await ctx.reply('Група не знайдена.');
      return ctx.scene.enter('GROUP_SELECTOR');
    }
    ctx.session.group = group;
    ctx.session.groupId = group.id;
    const ug = await UserGroup.findOne({ where: { UserId: ctx.session.user.id, GroupId: group.id }});
    ctx.session.isAdmin = ug ? ug.isAdmin : false;
    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    const name = ctx.message?.text;
    if (!name) return ctx.reply('Введіть назву групи текстом.');
    const group = await Group.create({ name });
    await UserGroup.create({ UserId: ctx.session.user.id, GroupId: group.id, isAdmin: true });
    ctx.session.group = group;
    ctx.session.groupId = group.id;
    ctx.session.isAdmin = true;
    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    const code = ctx.message?.text;
    if (!code) return ctx.reply('Введіть код текстом.');
    const group = await Group.findOne({ where: { inviteCode: code }});
    if (!group) {
      await ctx.reply('Недійсне запрошення.');
      return ctx.scene.enter('GROUP_SELECTOR');
    }
    const member = await UserGroup.findOne({ where: { UserId: ctx.session.user.id, GroupId: group.id }});
    if (member) {
      await ctx.reply('Ви вже є в цій групі.');
      return ctx.scene.enter('GROUP_SELECTOR');
    }
    await UserGroup.create({ UserId: ctx.session.user.id, GroupId: group.id, isAdmin: false });
    ctx.session.group = group;
    ctx.session.groupId = group.id;
    ctx.session.isAdmin = false;
    return ctx.scene.enter('SCHEDULE');
  }
);



const LabQueue = new Scenes.WizardScene(
  'LAB_QUEUE',
  async (ctx) => {
    const gid = ctx.session.labTargetGroupId || ctx.session.group?.id;
    if (!gid) {
      await ctx.reply('Група не вказана.');
      return ctx.scene.enter('GROUP_SELECTOR');
    }
    const group = await Group.findByPk(gid);
    if (!group) {
      await ctx.reply('Група не знайдена.');
      return ctx.scene.enter('GROUP_SELECTOR');
    }

    let links = [];
    try { links = group.labLinks ? JSON.parse(group.labLinks) : []; } catch (e) { links = []; }

    links = links.map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        const url = item;
        const label = (url.length > 30) ? url.slice(0,27) + '...' : url;
        return { label, url };
      }
      if (typeof item === 'object' && item.url) {
        const label = item.label ? String(item.label) : (String(item.url).length > 30 ? String(item.url).slice(0,27) + '...' : String(item.url));
        return { label, url: String(item.url) };
      }
      return null;
    }).filter(Boolean);

    const rows = [];
    if (links.length === 0) {
      rows.push([ Markup.button.callback('Немає посилань', 'noop') ]);
    } else {
      for (let i = 0; i < links.length; i++) {
        const { label, url } = links[i];
        const row = [ Markup.button.url(label, url) ];
        if (ctx.session.isAdmin) row.push(Markup.button.callback('❌', `lab_del_${gid}_${i}`));
        rows.push(row);
      }
    }

    if (ctx.session.isAdmin) {
      rows.push([ Markup.button.callback('➕ Додати посилання', `lab_add_${gid}`) ]);
    }
    rows.push([ Markup.button.callback('Назад', 'lab_back_to_group') ]);

    await ctx.reply(`Черга на лабу — група: ${group.name}`, Markup.inlineKeyboard(rows));
    return ctx.wizard.next();
  },

  async (ctx) => {
    const q = ctx.callbackQuery;
    if (!q) return;
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    const d = q.data;

    if (!d) return ctx.scene.enter('GROUP_SELECTOR');

    if (d === 'lab_back_to_group') {
      ctx.session.labTargetGroupId = null;
      ctx.session.pendingLabLabel = null;
      return ctx.scene.enter('SCHEDULE');
    }

    if (d.startsWith('lab_add_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав для додавання посилань.');
        return ctx.scene.enter('LAB_QUEUE');
      }
      const gid = Number(d.replace('lab_add_',''));
      ctx.session.labTargetGroupId = gid;
      ctx.session.pendingLabLabel = null;
      await ctx.reply('Надішліть назву посилання (короткий заголовок). Відправте /cancel для скасування.');
      return ctx.wizard.selectStep(2);
    }

    if (d.startsWith('lab_del_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав для видалення посилань.');
        return ctx.scene.enter('LAB_QUEUE');
      }
      const parts = d.split('_');
      const gid = Number(parts[2]);
      const idx = Number(parts[3]);
      const group = await Group.findByPk(gid);
      if (!group) {
        await ctx.reply('Група не знайдена.');
        return ctx.scene.enter('LAB_QUEUE');
      }
      let links = [];
      try { links = group.labLinks ? JSON.parse(group.labLinks) : []; } catch (e) { links = []; }
      if (isNaN(idx) || idx < 0 || idx >= links.length) {
        await ctx.reply('Неправильний індекс посилання.');
        return ctx.scene.enter('LAB_QUEUE');
      }
      links.splice(idx,1);
      group.labLinks = JSON.stringify(links);
      await group.save();
      await ctx.reply('Посилання видалено.');
      return ctx.scene.enter('LAB_QUEUE');
    }

    return ctx.scene.enter('LAB_QUEUE');
  },

  async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply('Будь ласка, надішліть назву текстом або /cancel.');
      return;
    }
    if (text === '/cancel' || text.toLowerCase() === 'скасувати' || text.toLowerCase() === 'відміна') {
      ctx.session.labTargetGroupId = null;
      ctx.session.pendingLabLabel = null;
      return ctx.scene.enter('LAB_QUEUE');
    }

    ctx.session.pendingLabLabel = text.trim().slice(0, 200); // limit length
    await ctx.reply('Тепер надішліть URL (починається з http:// або https://). Відправте /cancel для скасування.');
    return ctx.wizard.next();
  },


  async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply('Будь ласка, надішліть текст з посиланням або /cancel.');
      return;
    }
    if (text === '/cancel' || text.toLowerCase() === 'скасувати' || text.toLowerCase() === 'відміна') {
      ctx.session.labTargetGroupId = null;
      ctx.session.pendingLabLabel = null;
      return ctx.scene.enter('LAB_QUEUE');
    }

    const url = text.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      await ctx.reply('Неправильний формат URL. Починається з http:// або https://');
      return;
    }

    const gid = ctx.session.labTargetGroupId;
    const group = await Group.findByPk(gid);
    if (!group) {
      await ctx.reply('Група не знайдена.');
      ctx.session.labTargetGroupId = null;
      ctx.session.pendingLabLabel = null;
      return ctx.scene.enter('GROUP_SELECTOR');
    }

    let links = [];
    try { links = group.labLinks ? JSON.parse(group.labLinks) : []; } catch (e) { links = []; }

    const label = ctx.session.pendingLabLabel || ((url.length > 30) ? url.slice(0,27) + '...' : url);
    links.push({ label, url });
    group.labLinks = JSON.stringify(links);
    await group.save();

    ctx.session.labTargetGroupId = null;
    ctx.session.pendingLabLabel = null;
    await ctx.reply('Посилання додано.');
    return ctx.scene.enter('LAB_QUEUE');
  }
);



const GroupSettings = new Scenes.WizardScene(
  'GROUP_SETTINGS',
  async (ctx) => {
    const inviteCode = ctx.session.group?.inviteCode ? "\n🔗 Код запрошення: " + ctx.session.group.inviteCode : '';
    await ctx.reply('⚙️ Налаштування *' + (ctx.session.group?.name || '') + '*' + inviteCode, Markup.inlineKeyboard([
      [ Markup.button.callback('👤 Учасники', 'members') ],
      [ Markup.button.callback('↩️ Вибір групи', 'groups') ],
      [ Markup.button.callback('⬅️ Назад', 'back') ]
    ]));
    return ctx.wizard.next();
  },

  async (ctx) => {
    const query = ctx.callbackQuery;
    if (!query) return;
    try { await ctx.telegram.answerCbQuery(query.id).catch(()=>{}); } catch {}
    const d = query.data;

    if (d === 'members') {
      ctx.session.group = await Group.findByPk(ctx.session.group.id, { include: User });
      const inviteToggle = ctx.session.group.inviteCode ? "🔓 Запрошення увімкнено" : "🔒 Запрошення вимкнено";

      const buttons = [];
      for (const member of ctx.session.group.Users || []) {
        const ug = await UserGroup.findOne({ where: { UserId: member.id, GroupId: ctx.session.group.id }});
        const isMemberAdmin = ug ? !!ug.isAdmin : false;
        const chat = await ctx.telegram.getChat(member.id).catch(()=>null);
        const name = chat ? (chat.first_name + ' ' + (chat.last_name || '')) : String(member.id);
        const link = chat && chat.username ? "https://t.me/" + chat.username : null;

        const row = [];
        row.push(link ? Markup.button.url(name, link) : Markup.button.callback(name, 'noop'));

        if (ctx.session.isAdmin) {
          // not allow changing your own admin flag or removing yourself 
          if (member.id !== ctx.session.user.id) {
            if (isMemberAdmin) {
              row.push(Markup.button.callback('👑', `revoke_admin_${member.id}`));
            } else {
              row.push(Markup.button.callback('⭐', `make_admin_${member.id}`));
            }
            row.push(Markup.button.callback('❌', `remove_${member.id}`));
          } else {
            if (isMemberAdmin) row.push(Markup.button.callback('Ви (адмін)', 'noop'));
          }
        }

        buttons.push(row);
      }

      const keyboardRows = [
        ...ctx.session.isAdmin ? [ [ Markup.button.callback(inviteToggle, 'toggleInvite') ] ] : [],
        ...buttons,
        [ Markup.button.callback('⬅️ Назад', 'back') ]
      ];

      await ctx.reply('👤 Учасники *' + ctx.session.group.name + '*', Markup.inlineKeyboard(keyboardRows));
      return ctx.wizard.selectStep(2);
    }

    if (d === 'groups') return ctx.scene.enter('GROUP_SELECTOR');
    if (d === 'back') return ctx.scene.enter('SCHEDULE');
    return;
  },

  async (ctx) => {
    const query = ctx.callbackQuery;
    if (!query) return;
    try { await ctx.telegram.answerCbQuery(query.id).catch(()=>{}); } catch {}
    const d = query.data;

    if (d === 'toggleInvite') {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      if (ctx.session.group.inviteCode) {
        ctx.session.group.inviteCode = null;
        await ctx.session.group.save();
      } else {
        let success = false;
        do {
          try {
            const min = 10000000, max = 99999999;
            const code = Math.floor(Math.random() * (max - min + 1)) + min;
            ctx.session.group.inviteCode = String(code);
            await ctx.session.group.save();
            success = true;
          } catch (err) { console.error(err); }
        } while (!success);
      }
      return ctx.scene.enter('GROUP_SETTINGS');
    }

    if (d && d.startsWith('make_admin_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      const uid = Number(d.replace('make_admin_',''));
      const [ug] = await UserGroup.findOrCreate({ where: { UserId: uid, GroupId: ctx.session.group.id }, defaults: { isAdmin: true }});
      ug.isAdmin = true;
      await ug.save();
      await ctx.reply('Роль адміністратора видана.');
      return ctx.scene.enter('GROUP_SETTINGS');
    }

    if (d && d.startsWith('revoke_admin_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      const uid = Number(d.replace('revoke_admin_',''));
      if (uid === ctx.session.user.id) {
        await ctx.reply('Не можна забрати у себе права адміністратора.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      const ug = await UserGroup.findOne({ where: { UserId: uid, GroupId: ctx.session.group.id }});
      if (!ug) {
        await ctx.reply('Користувач не є учасником групи.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      ug.isAdmin = false;
      await ug.save();
      await ctx.reply('Роль адміністратора забрана.');
      return ctx.scene.enter('GROUP_SETTINGS');
    }

    if (d && d.startsWith('remove_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      const uid = Number(d.replace('remove_',''));
      if (uid === ctx.session.user.id) {
        await ctx.reply('Не можна видалити себе з групи.');
        return ctx.scene.enter('GROUP_SETTINGS');
      }
      await UserGroup.destroy({ where: { UserId: uid, GroupId: ctx.session.group.id }});
      await ctx.reply('Користувача видалено з групи.');
      return ctx.scene.enter('GROUP_SETTINGS');
    }

    if (d === 'back') return ctx.scene.enter('SCHEDULE');
    return;
  }
);


const Schedule = new Scenes.WizardScene(
  'SCHEDULE',
  async (ctx) => {
    if (!ctx.session.date) ctx.session.date = new Date();
    const date = ctx.session.date instanceof Date ? ctx.session.date : new Date(ctx.session.date);
    const formattedDate = new Intl.DateTimeFormat("uk-UA").format(date);

    const dayVariants = {
      0: ['Вс', 'Нд', 'Ндн'],
      1: ['Пн', 'Пон', 'ПН'],
      2: ['Вт', 'Вв', 'Втор', 'ВТ'],
      3: ['Ср', 'Середа', 'СР'],
      4: ['Чт', 'Чтв', 'ЧТ'],
      5: ['Пт', 'Птн', 'ПТ'],
      6: ['Сб', 'Суб', 'СБ']
    };
    const dayIndex = date.getDay();
    const candidates = dayVariants[dayIndex] || [];
    const dayLabel = candidates[0] || date.toLocaleDateString('uk-UA', { weekday: 'short' });

    function getWeekNumber(d) {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((d - onejan) / 86400000) + 1;
      return Math.ceil((dayOfYear + ((onejan.getDay() + 6) % 7)) / 7);
    }
    const weekNum = getWeekNumber(date);
    const weekType = (weekNum % 2 === 1) ? 'first' : 'second';

    const lessons = await Lesson.findAll({
      where: {
        GroupId: ctx.session.group?.id || null,
        day: { [Op.in]: candidates },
        [Op.or]: [
          { weekType: weekType },
          { weekType: 'both' },
          { weekType: null }
        ]
      },
      include: Subject,
      order: [['timestamp', 'ASC']]
    });

    const lessonButtons = lessons.map(l => {
      const time = l.timestamp || '—';
      const subj = l.Subject ? l.Subject.name : 'Не вказано';
      const label = `${time} — ${subj}`;
      return [ Markup.button.callback(label, `lesson_${l.id}`) ];
    });


    const keyboard = [
      ...lessonButtons,
      ...ctx.session.isAdmin ? [ [ Markup.button.callback('➕ Змінити пари', 'new') ] ] : [],
      [ Markup.button.callback('📋 Черга на лабу', 'lab_queue') ],
      [ Markup.button.callback('⚙️ Налаштування', 'settings') ],
      [ Markup.button.callback('<<<', 'prev'), Markup.button.callback(dayLabel, 'date'), Markup.button.callback('>>>', 'next') ]
    ];

    let text = `<<< 📅 Розклад на ${formattedDate} (${dayLabel}) >>>\n\n`;
    if (!lessons || lessons.length === 0) text += 'На обрану дату немає пар.';
   
    await ctx.reply(text, Markup.inlineKeyboard(keyboard));
    return ctx.wizard.next();
  },

  async (ctx) => {
    const query = ctx.callbackQuery;
    if (!query) return;

    const d = query.data;

    if (d === 'noop') {
      try { await ctx.telegram.answerCbQuery(query.id).catch(()=>{}); } catch {}
      return; 
    }

    try {
      await ctx.telegram.answerCbQuery(query.id).catch(()=>{});
      await ctx.telegram.deleteMessage(ctx.session.user.id, query.message.message_id).catch(()=>{});
    } catch {}

    if (d && d.startsWith('lesson_')) {
      const id = Number(d.replace('lesson_',''));
      const lesson = await Lesson.findByPk(id, { include: Subject });
      if (!lesson) {
        await ctx.reply('Пара не знайдена.');
        return ctx.scene.enter('SCHEDULE');
      }

      const subj = lesson.Subject ? lesson.Subject.name : 'Не вказано';
      const day = lesson.day || '—';
      const time = lesson.timestamp || '—';
      const week = lesson.weekType || '—';
      const practice = lesson.isPractice ? 'Практика' : 'Лекція';
      const hw = lesson.homework || 'Нет';
      const link = lesson.meetingLink || null;
      const aud = lesson.audience || 'Немає';

      const info = `Пара:\nПредмет: ${subj}\nЧас: ${time}\n${practice}\n\nДомашнє: ${hw}\nАудиторія: ${aud}\nПосилання: ${link ? link : 'Немає'}`;

      const adminRow = [];
      if (ctx.session.isAdmin) {
        adminRow.push(Markup.button.callback('🏫 Аудиторія', `aud_${lesson.id}`));
        adminRow.push(Markup.button.callback('🔗 Посилання', `link_${lesson.id}`));
      }

      const kb = Markup.inlineKeyboard([
        [ Markup.button.callback('Додати дз', `addhw_${lesson.id}`) ],
        ...(adminRow.length ? [ adminRow ] : []),
        [ Markup.button.callback('Назад', 'back_to_schedule') ]
      ]);

      await ctx.reply(info, kb);
      return;
    }

    if (d && d.startsWith('link_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав для зміни посилань.');
        return ctx.scene.enter('SCHEDULE');
      }
      const id = Number(d.replace('link_',''));
      ctx.session.pendingLinkLessonId = id;
      return ctx.scene.enter('EDIT_LINK');
    }

    if (d && d.startsWith('aud_')) {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав для зміни аудиторії.');
        return ctx.scene.enter('SCHEDULE');
      }
      const id = Number(d.replace('aud_',''));
      ctx.session.pendingAudLessonId = id;
      return ctx.scene.enter('EDIT_AUDIENCE');
    }

    if (d === 'date') {
      const base = ctx.session.date ? new Date(ctx.session.date) : new Date();
      const baseMonthFirst = new Date(base.getFullYear(), base.getMonth(), 1);
      ctx.session.calendarBase = baseMonthFirst;
      await sendMonthCalendar(ctx, ctx.session.calendarBase);
      return;
    }

    if (d && d.startsWith('cal_nav_')) {
      const parts = d.split('_');
      const dir = parts[2]; // prev or next
      const year = Number(parts[3]);
      const month = Number(parts[4]);
      const currentBase = ctx.session.calendarBase ? new Date(ctx.session.calendarBase) : new Date(year, month, 1);
      if (dir === 'prev') currentBase.setMonth(currentBase.getMonth() - 1);
      else if (dir === 'next') currentBase.setMonth(currentBase.getMonth() + 1);
      ctx.session.calendarBase = new Date(currentBase.getFullYear(), currentBase.getMonth(), 1);
      await sendMonthCalendar(ctx, ctx.session.calendarBase);
      return;
    }

    if (d && d.startsWith('pickdate_')) {
      const dateStr = d.replace('pickdate_',''); // YYYY-MM-DD
      const newDate = new Date(dateStr + 'T00:00:00');
      if (isNaN(newDate)) {
        await ctx.reply('Неправильна дата.');
        return ctx.scene.enter('SCHEDULE');
      }
      ctx.session.date = newDate;
      ctx.session.calendarBase = null;
      return ctx.scene.enter('SCHEDULE');
    }

    if (d === 'lab_queue') {
      const gid = ctx.session.group?.id;
      if (!gid) {
        await ctx.reply('Група не обрана. Виберіть групу спочатку.');
        return ctx.scene.enter('GROUP_SELECTOR');
      }
      ctx.session.labTargetGroupId = gid;
      return ctx.scene.enter('LAB_QUEUE');
    }

    if (d && d.startsWith('addhw_')) {
      const id = Number(d.replace('addhw_',''));
      ctx.session.pendingHomeworkLessonId = id;
      return ctx.scene.enter('ADD_HOMEWORK');
    }

     if (d === 'back_to_schedule') return ctx.scene.enter('SCHEDULE');
    if (d === 'prev') { ctx.session.date.setDate(ctx.session.date.getDate() - 1); return ctx.scene.enter('SCHEDULE'); }
    if (d === 'next') { ctx.session.date.setDate(ctx.session.date.getDate() + 1); return ctx.scene.enter('SCHEDULE'); }
    if (d === 'settings') return ctx.scene.enter('GROUP_SETTINGS');

    if (d === 'new') {
      if (!ctx.session.isAdmin) {
        await ctx.reply('У вас немає прав для змін розкладу.');
        return ctx.scene.enter('SCHEDULE');
      }
      return ctx.scene.enter('ADD_LESSON');
    }

    return;
  }
);



const AddLesson = new Scenes.WizardScene(
  'ADD_LESSON',


  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.reply('У вас немає прав для управління парами.');
    await ctx.reply('Що ви хочете зробити?', Markup.inlineKeyboard([
      [ Markup.button.callback('➕ Додати пару', 'add_new') ],
      [ Markup.button.callback('🗑️ Видалити пару', 'delete_existing') ],
      [ Markup.button.callback('Скасувати', 'cancel') ]
    ]));
    return ctx.wizard.next();
  },

  
  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Натисніть кнопку.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}

    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');

 
    if (q.data === 'delete_existing') {
      if (!ctx.session.group?.id) return ctx.reply('Група не вибрана.');
      const lessons = await Lesson.findAll({ 
        where: { GroupId: ctx.session.group.id }, 
        include: Subject, 
        order: [['day','ASC'], ['timestamp','ASC']] 
      });
      if (!lessons || lessons.length === 0) {
        await ctx.reply('У групі немає пар для видалення.');
        return ctx.scene.enter('SCHEDULE');
      }
      const rows = lessons.map(l => {
        const subj = l.Subject ? l.Subject.name : 'Не вказано';
        const label = `${l.day || '—'} ${l.timestamp || '—'} — ${subj}`;
        return [ Markup.button.callback(label, `del_lesson_${l.id}`) ];
      });
      rows.push([ Markup.button.callback('⬅️ Назад', 'back_to_add_menu') ]);
      await ctx.reply('Виберіть пару для видалення:', Markup.inlineKeyboard(rows));
      return ctx.wizard.selectStep(8);
    }


    if (q.data === 'add_new') {
      await ctx.reply('Виберіть день:', Markup.inlineKeyboard([
        [ Markup.button.callback('Пн','day_Пн'), Markup.button.callback('Вт','day_Вт') ],
        [ Markup.button.callback('Ср','day_Ср'), Markup.button.callback('Чт','day_Чт') ],
        [ Markup.button.callback('Пт','day_Пт'), Markup.button.callback('Сб','day_Сб') ],
        [ Markup.button.callback('Скасувати','cancel') ]
      ]));
      return ctx.wizard.next();
    }

    return ctx.scene.enter('SCHEDULE');
  },

 
  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Будь ласка, виберіть день кнопкою.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');
    if (!q.data.startsWith('day_')) return ctx.scene.enter('SCHEDULE');

    const day = q.data.replace('day_','');
    ctx.wizard.state.newLesson = { day };
    await ctx.reply('Введіть час пари у форматі HH:MM (наприклад 08:30):');
    return ctx.wizard.next();
  },


  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const time = ctx.message?.text;
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      await ctx.reply('Неправильний формат часу. Введіть у форматі HH:MM (наприклад 08:30).');
      return;
    }
    ctx.wizard.state.newLesson.time = time;


    await ctx.reply('Виберіть тип заняття:', Markup.inlineKeyboard([
      [ Markup.button.callback('📖 Лекція', 'type_lecture') ],
      [ Markup.button.callback('🧩 Практика', 'type_practice') ],
      [ Markup.button.callback('Скасувати', 'cancel') ]
    ]));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Будь ласка, виберіть тип кнопкою.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');

    if (q.data === 'type_lecture') ctx.wizard.state.newLesson.isPractice = false;
    else if (q.data === 'type_practice') ctx.wizard.state.newLesson.isPractice = true;
    else return ctx.scene.enter('SCHEDULE');

    const subs = await Subject.findAll({ where: { GroupId: ctx.session.group.id } });
    const buttons = subs.map(s => [ Markup.button.callback(s.name, `sub_${s.id}`) ]);
    buttons.push([ Markup.button.callback('➕ Новий предмет', 'sub_new') ]);
    buttons.push([ Markup.button.callback('Скасувати','cancel') ]);

    await ctx.reply('Виберіть предмет або створіть новий:', Markup.inlineKeyboard(buttons));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Будь ласка, виберіть предмет кнопкою.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');

    if (q.data === 'sub_new') {
      await ctx.reply('Введіть назву нового предмета текстом:');
      return ctx.wizard.next();
    }

    if (q.data.startsWith('sub_')) {
      ctx.wizard.state.newLesson.subjectId = Number(q.data.replace('sub_',''));
      await ctx.reply('Виберіть номер тижня:', Markup.inlineKeyboard([
        [ Markup.button.callback('Перший', 'week_first'), Markup.button.callback('Другий', 'week_second') ],
        [ Markup.button.callback('Обидва', 'week_both') ],
        [ Markup.button.callback('Скасувати','cancel') ]
      ]));
      return ctx.wizard.selectStep(7);
    }

    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const name = ctx.message?.text;
    if (!name) return ctx.reply('Введіть назву предмета текстом.');
    const [subject] = await Subject.findOrCreate({ where: { name }, defaults: { GroupId: ctx.session.group.id }});
    ctx.wizard.state.newLesson.subjectId = subject.id;

    await ctx.reply('Виберіть номер тижня:', Markup.inlineKeyboard([
      [ Markup.button.callback('Перший', 'week_first'), Markup.button.callback('Другий', 'week_second') ],
      [ Markup.button.callback('Обидва', 'week_both') ],
      [ Markup.button.callback('Скасувати','cancel') ]
    ]));
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Будь ласка, виберіть номер тижня кнопкою.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');

    let weekType = null;
    if (q.data === 'week_first') weekType = 'second';
    if (q.data === 'week_second') weekType = 'first';
    if (q.data === 'week_both') weekType = 'both';

    const nl = ctx.wizard.state.newLesson;
    if (!nl || !nl.subjectId || !nl.time || !nl.day) {
      await ctx.reply('Помилка при додаванні пари. Спробуйте ще раз.');
      return ctx.scene.enter('SCHEDULE');
    }

    await Lesson.create({
      timestamp: nl.time,
      isPractice: nl.isPractice ?? false,
      meetingLink: null,
      recordingLink: null,
      homework: null,
      GroupId: ctx.session.group.id,
      SubjectId: nl.subjectId,
      day: nl.day,
      weekType
    });

    await ctx.reply(`✅ Пара додана: ${nl.day} ${nl.time} (${nl.isPractice ? 'практика' : 'лекція'})`);
    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Натисніть кнопку для видалення або назад.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    const d = q.data;
    if (d === 'back_to_add_menu') {
      return ctx.wizard.selectStep(1);
    }

    if (d && d.startsWith('del_lesson_')) {
      const id = Number(d.replace('del_lesson_',''));
      const lesson = await Lesson.findByPk(id, { include: Subject });
      if (!lesson) {
        await ctx.reply('Пара не знайдена.');
        return ctx.scene.enter('SCHEDULE');
      }
      const subj = lesson.Subject ? lesson.Subject.name : 'Не вказано';
      const label = `${lesson.day || '—'} ${lesson.timestamp || '—'} — ${subj}`;
      await ctx.reply(`Ви впевнені, що хочете видалити пару:\n${label}`, Markup.inlineKeyboard([
        [ Markup.button.callback('Так, видалити', `confirm_del_${id}`) ],
        [ Markup.button.callback('Ні, назад', 'back_to_add_menu') ]
      ]));
      return ctx.wizard.selectStep(9);
    }

    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.scene.enter('SCHEDULE');
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Натисніть кнопку.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    const d = q.data;
    if (d === 'back_to_add_menu') {
      return ctx.wizard.selectStep(1);
    }
    if (d && d.startsWith('confirm_del_')) {
      const id = Number(d.replace('confirm_del_',''));
      const lesson = await Lesson.findByPk(id);
      if (!lesson) {
        await ctx.reply('Пара не знайдена.');
        return ctx.scene.enter('SCHEDULE');
      }
      await lesson.destroy();
      await ctx.reply('🗑️ Пара видалена.');
      return ctx.scene.enter('SCHEDULE');
    }
    return ctx.scene.enter('SCHEDULE');
  }
);

const EditLink = new Scenes.WizardScene(
  'EDIT_LINK',
  async (ctx) => {
    const id = ctx.session.pendingLinkLessonId;
    if (!id) {
      await ctx.reply('Не вказана пара.');
      return ctx.scene.enter('SCHEDULE');
    }
    const lesson = await Lesson.findByPk(id, { include: Subject });
    if (!lesson) {
      await ctx.reply('Пара не знайдена.');
      ctx.session.pendingLinkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }
    const current = lesson.meetingLink || 'Немає';
    await ctx.reply(`Поточне посилання: ${current}\n\nНадішліть нове посилання (починається з http:// або https://), або надішліть /remove для видалення, /cancel — відміна.`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) {
      await ctx.reply('У вас немає прав для зміни посилання.');
      ctx.session.pendingLinkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }

    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply('Будь ласка, надішліть текст з посиланням або команду.');
      return;
    }

    const id = ctx.session.pendingLinkLessonId;
    const lesson = await Lesson.findByPk(id);
    if (!lesson) {
      await ctx.reply('Пара не знайдена.');
      ctx.session.pendingLinkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }

    if (text === '/cancel' || text.toLowerCase() === 'відміна' || text.toLowerCase() === 'cancel') {
      ctx.session.pendingLinkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }

    if (text === '/remove' || text.toLowerCase() === 'видалити' || text.toLowerCase() === 'remove') {
      lesson.meetingLink = null;
      await lesson.save();
      ctx.session.pendingLinkLessonId = null;
      await ctx.reply('Посилання видалено.');
      return ctx.scene.enter('SCHEDULE');
    }

    const url = text.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      await ctx.reply('Неправильний формат URL. Починається з http:// або https:// або надішліть /remove для видалення.');
      return;
    }

    lesson.meetingLink = url;
    await lesson.save();
    ctx.session.pendingLinkLessonId = null;
    await ctx.reply('Посилання збережено.');
    return ctx.scene.enter('SCHEDULE');
  }
);



const AddHomework = new Scenes.WizardScene(
  'ADD_HOMEWORK',
  async (ctx) => {
    if (!ctx.session.isAdmin) {
      await ctx.reply('У вас немає прав для зміни домашніх.');
      ctx.session.pendingLinkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }
  },
  async (ctx) => {
    const lessonId = ctx.session.pendingHomeworkLessonId;
    
    if (!lessonId) {
      await ctx.reply('Помилка: не вказана пара для додавання домашнього завдання.');
      return ctx.scene.enter('SCHEDULE');
    }
    await ctx.reply('Введіть текст домашнього завдання для цієї пари. Відправте /cancel для скасування.');
    return ctx.wizard.next();
  },

  async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      await ctx.reply('Будь ласка, введіть текст домашнього завдання.');
      return;
    }
    if (text === '/cancel' || text.toLowerCase() === 'відміна') {
      ctx.session.pendingHomeworkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }
    const id = ctx.session.pendingHomeworkLessonId;
    const lesson = await Lesson.findByPk(id);
    if (!lesson) {
      await ctx.reply('Пара не знайдена.');
      ctx.session.pendingHomeworkLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }
    lesson.homework = text;
    await lesson.save();
    ctx.session.pendingHomeworkLessonId = null;
    await ctx.reply('Домашнє завдання додано.');
    return ctx.scene.enter('SCHEDULE');
  }
);


const EditAudience = new Scenes.WizardScene(
  'EDIT_AUDIENCE',
  async (ctx) => {
    const id = ctx.session.pendingAudLessonId;
    if (!id) {
      await ctx.reply('Не вказана пара.');
      return ctx.scene.enter('SCHEDULE');
    }
    const lesson = await Lesson.findByPk(id, { include: Subject });
    if (!lesson) {
      await ctx.reply('Пара не знайдена.');
      ctx.session.pendingAudLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }
    const current = lesson.audience || 'Немає';
    await ctx.reply(`Поточна аудиторія: ${current}\n\nНадішліть нову аудиторію тільки цифрами (наприклад "401"), або надішліть /remove для видалення, /cancel — відміна.`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    if (!ctx.session.isAdmin) {
      await ctx.reply('У вас немає прав для зміни аудиторії.');
      ctx.session.pendingAudLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }

    const text = (ctx.message?.text || '').trim();
    if (!text) {
      await ctx.reply('Будь ласка, надішліть текст з аудиторією або команду.');
      return;
    }

    const id = ctx.session.pendingAudLessonId;
    const lesson = await Lesson.findByPk(id);
    if (!lesson) {
      await ctx.reply('Пара не знайдена.');
      ctx.session.pendingAudLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }

    if (text === '/cancel' || text.toLowerCase() === 'відміна' || text.toLowerCase() === 'cancel') {
      ctx.session.pendingAudLessonId = null;
      return ctx.scene.enter('SCHEDULE');
    }

    if (text === '/remove' || text.toLowerCase() === 'видалити' || text.toLowerCase() === 'remove') {
      lesson.audience = null;
      await lesson.save({ fields: ['audience'] });
      ctx.session.pendingAudLessonId = null;
      await ctx.reply('Аудиторія видалена.');
      return ctx.scene.enter('SCHEDULE');
    }

    if (!/^\d+$/.test(text)) {
      await ctx.reply('Невірний формат аудиторії. Допускаються тільки цифри, наприклад: 401');
      return;
    }

    lesson.audience = text;
    await lesson.save({ fields: ['audience'] });

    ctx.session.pendingAudLessonId = null;
    await ctx.reply('Аудиторія збережена.');
    return ctx.scene.enter('SCHEDULE');
  }
);


export default new Scenes.Stage([ GroupSelector, GroupSettings, Schedule, AddLesson, AddHomework, LabQueue, EditLink, EditAudience ]);