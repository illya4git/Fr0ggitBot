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

  for (let i = 0; i < firstWeekdayMondayIndex; i++) {
      cells.push(null);
    }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(new Date(year, month, d));
  }


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

  // footer/back
  rows.push([ Markup.button.callback('Назад', 'back_to_schedule') ]);

  await ctx.reply('Виберіть точну дату:', Markup.inlineKeyboard(rows));
}


// ---------------- scenes ----------------

const GroupSelector = new Scenes.WizardScene(
  'GROUP_SELECTOR',
  async (ctx) => {
    const user = await User.findByPk(ctx.session.user.id, { include: Group });
    const groups = (user && user.Groups) || [];

    await ctx.reply('Оберіть группу:', Markup.inlineKeyboard([
      ...groups.map(group => [ Markup.button.callback(group.name, String(group.id)) ]),
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
      await ctx.reply('Будьте ласкаві, уведіть код вашого запрошення.');
      return ctx.wizard.selectStep(3);
    }

    ctx.session.group = await Group.findByPk(data);
    const ug = await UserGroup.findOne({ where: { UserId: ctx.session.user.id, GroupId: ctx.session.group.id }});
    ctx.session.isAdmin = ug ? ug.isAdmin : false;
    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    const name = ctx.message?.text;
    if (!name) return ctx.reply('Введіть назву групи текстом.');
    const group = await Group.create({ name });
    await UserGroup.create({ UserId: ctx.session.user.id, GroupId: group.id, isAdmin: true });
    ctx.session.group = group;
    ctx.session.isAdmin = true;
    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
    const code = ctx.message?.text;
    if (!code) return ctx.reply('Введіть код запрошення текстом.');
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
    ctx.session.isAdmin = false;
    return ctx.scene.enter('SCHEDULE');
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
        const chat = await ctx.telegram.getChat(member.id).catch(()=>null);
        const name = chat ? (chat.first_name + ' ' + (chat.last_name || '')) : String(member.id);
        const link = chat && chat.username ? "https://t.me/" + chat.username : null;
        buttons.push([
          link ? Markup.button.url(name, link) : Markup.button.callback(name, 'noop'),
          ...ctx.session.isAdmin ? [ Markup.button.callback('❌', String(member.id)) ] : []
        ]);
      }

      await ctx.reply('👤 Учасники *' + ctx.session.group.name + '*', Markup.inlineKeyboard([
        ...ctx.session.isAdmin ? [ [ Markup.button.callback(inviteToggle, 'toggleInvite') ] ] : [],
        ...buttons,
        [ Markup.button.callback('⬅️ Назад', 'back') ]
      ]));
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
    if (d === 'back') return ctx.scene.enter('GROUP_SETTINGS');
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
      ...ctx.session.isAdmin ? [ [ Markup.button.callback('➕ Додати пару', 'new') ] ] : [],
      [ Markup.button.callback('⚙️ Налаштування', 'settings') ],
      [ Markup.button.callback('<<<', 'prev'), Markup.button.callback(dayLabel, 'date'), Markup.button.callback('>>>', 'next') ]
    ];

    let text = `<<< 📅 Розклад на ${formattedDate} (${dayLabel}) >>>\n\n`;
    if (!lessons || lessons.length === 0) text += 'На обрану дату немає пар.';
    else {
      for (const l of lessons) {
        const time = l.timestamp || '—';
        const subj = l.Subject ? l.Subject.name : 'Не вказано';
        text += `${time} — ${subj}\n`;
      }
    }

    await ctx.reply(text, Markup.inlineKeyboard(keyboard));
    return ctx.wizard.next();
  },

  async (ctx) => {
    const query = ctx.callbackQuery;
    if (!query) return;

    try {
      await ctx.telegram.answerCbQuery(query.id).catch(()=>{});
      await ctx.telegram.deleteMessage(ctx.session.user.id, ctx.callbackQuery.message.message_id).catch(()=>{});
    } catch {}

    const d = ctx.callbackQuery.data;

    
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

      const info = `Пара:\nПредмет: ${subj}\nВремя: ${time}\nДень: ${day}\nТип недели: ${week}\n ${practice}\n\nДомашнее: ${hw}`;

      const kb = Markup.inlineKeyboard([
        [ Markup.button.callback('Додати дз', `addhw_${lesson.id}`) ],
        [ Markup.button.callback('Назад', 'back_to_schedule') ]
      ]);

      await ctx.reply(info, kb);
      return;
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
      const dir = parts[2]; 
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

    
    if (d && d.startsWith('addhw_')) {
      const id = Number(d.replace('addhw_',''));
      ctx.session.pendingHomeworkLessonId = id;
      return ctx.scene.enter('ADD_HOMEWORK');
    }

    if (d === 'back_to_schedule') return ctx.scene.enter('SCHEDULE');
    if (d === 'prev') { ctx.session.date.setDate(ctx.session.date.getDate() - 1); return ctx.scene.enter('SCHEDULE'); }
    if (d === 'next') { ctx.session.date.setDate(ctx.session.date.getDate() + 1); return ctx.scene.enter('SCHEDULE'); }
    if (d === 'settings') return ctx.scene.enter('GROUP_SETTINGS');
    if (d === 'new') return ctx.scene.enter('ADD_LESSON');

    return;
  }
);



const AddLesson = new Scenes.WizardScene(
  'ADD_LESSON',
  async (ctx) => {
    if (!ctx.session.isAdmin) return ctx.reply('У вас немає прав для додавання пар.');
    await ctx.reply('Выберите день:', Markup.inlineKeyboard([
      [ Markup.button.callback('Пн','day_Пн'), Markup.button.callback('Вт','day_Вт') ],
      [ Markup.button.callback('Ср','day_Ср'), Markup.button.callback('Чт','day_Чт') ],
      [ Markup.button.callback('Пт','day_Пт'), Markup.button.callback('Сб','day_Сб') ],
      [ Markup.button.callback('Скасувати','cancel') ]
    ]));
    return ctx.wizard.next();
  },

  async (ctx) => {
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Будь ласка, виберіть день кнопкою.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');
    const day = q.data.replace('day_','');
    ctx.wizard.state.newLesson = { day };
    await ctx.reply('Введіть час пари в форматі HH:MM (наприклад 08:30):');
    return ctx.wizard.next();
  },

  async (ctx) => {
    const time = ctx.message?.text;
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      await ctx.reply('Неправильний формат часу. Введіть в форматі HH:MM (наприклад 08:30).');
      return;
    }
    ctx.wizard.state.newLesson.time = time;

    const subs = await Subject.findAll({ where: { GroupId: ctx.session.group.id } });
    const buttons = subs.map(s => [ Markup.button.callback(s.name, `sub_${s.id}`) ]);
    buttons.push([ Markup.button.callback('➕ Новий предмет', 'sub_new') ]);
    buttons.push([ Markup.button.callback('Скасувати','cancel') ]);

    await ctx.reply('Виберіть предмет або створіть новий:', Markup.inlineKeyboard(buttons));
    return ctx.wizard.next();
  },

  async (ctx) => {
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
      return ctx.wizard.selectStep(4);
    }

    return ctx.scene.enter('SCHEDULE');
  },

  async (ctx) => {
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
    const q = ctx.callbackQuery;
    if (!q) return ctx.reply('Будь ласка, виберіть номер тижня кнопкою.');
    try { await ctx.telegram.answerCbQuery(q.id).catch(()=>{}); } catch {}
    if (q.data === 'cancel') return ctx.scene.enter('SCHEDULE');

    let weekType = null;
    if (q.data === 'week_first') weekType = 'first';
    if (q.data === 'week_second') weekType = 'second';
    if (q.data === 'week_both') weekType = 'both';

    const nl = ctx.wizard.state.newLesson;
    if (!nl || !nl.subjectId || !nl.time || !nl.day) {
      await ctx.reply('Помилка при додаванні пари. Спробуйте ще раз.');
      return ctx.scene.enter('SCHEDULE');
    }

    await Lesson.create({
      timestamp: nl.time,
      isPractice: false,
      meetingLink: null,
      recordingLink: null,
      homework: null,
      GroupId: ctx.session.group.id,
      SubjectId: nl.subjectId,
      day: nl.day,
      weekType
    });

    await ctx.reply(`Пара додана: ${nl.day} ${nl.time}`);
    return ctx.scene.enter('SCHEDULE');
  }
);


const AddHomework = new Scenes.WizardScene(
  'ADD_HOMEWORK',
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


export default new Scenes.Stage([ GroupSelector, GroupSettings, Schedule, AddLesson, AddHomework]);