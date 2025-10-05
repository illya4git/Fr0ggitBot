import { Scenes, Markup } from 'telegraf';
import Calendar from 'telegraf-calendar-telegram';
import { Group, UserGroups } from "./Models.js";

const testArr = [
  ['sub 1', 'sub 2', 'sub 3', 'sub 4'],
  ['sub 1', 'sub 2', 'sub 3'],
  ['sub 1', 'sub 2', 'sub 3', 'sub 4', 'sub 5']
];

function getSubsForDate(date) {
  const day = new Date(date).getDate();
  const index = day % testArr.length;
  return testArr[index];
}

function getKeyboardForDate(date) {
  const subs = getSubsForDate(date);

  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  const prevDate = prev.toISOString().slice(0, 10);

  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);

  return Markup.inlineKeyboard([
    ...subs.map((item, i) => [
      Markup.button.callback(item, `sub_${date}_${i}`)
    ]),
    [
      Markup.button.callback('«', `date_${prevDate}`),
      Markup.button.callback(date, `calendar_${date}`),
      Markup.button.callback('»', `date_${nextDate}`)
    ],
    [Markup.button.callback('Exit', 'exit')]
  ]);
}

// --- Экспортируем функцию, принимающую bot ---
export default function createStage(bot) {
  const calendar = new Calendar(bot, {
    startWeekDay: 1,
    weekDayNames: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],
    monthNames: [
      'Январь','Февраль','Март','Апрель','Май','Июнь',
      'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
    ]
  });

  const ScheduleScene = new Scenes.BaseScene('SCHEDULE');
  ScheduleScene.enter(async (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    await ctx.reply(`Сегодняшняя дата: ${today}. Выбери предмет:`, getKeyboardForDate(today));
  });

  ScheduleScene.action(/sub_(\d{4}-\d{2}-\d{2})_(\d+)/, async (ctx) => {
    const date = ctx.match[1];
    const subIndex = Number(ctx.match[2]);
    const chosen = getSubsForDate(date)[subIndex];

    await ctx.editMessageText(
      `Ты выбрал *${chosen}* на дату ${date}`,
      {
        parse_mode: 'Markdown',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('Назад', `back_${date}`)],
          [Markup.button.callback('Продолжить', `continue_${date}_${subIndex}`)]
        ]).reply_markup
      }
    );
  });

  ScheduleScene.action(/back_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
    const date = ctx.match[1];
    const text = `Ты выбрал дату: ${date}. Выбери предмет:`;
    const keyboard = getKeyboardForDate(date);

    try {
      await ctx.editMessageText(text, { reply_markup: keyboard.reply_markup });
    } catch (e) {
      if (!e.description.includes('message is not modified')) {
        console.error(e);
      }
    }
  });

  ScheduleScene.action(/calendar_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
    const date = ctx.match[1];
    const dateStr = new Date(date);
    await ctx.editMessageText('Выбери точную дату:', calendar.getCalendar(dateStr));
  });

  ScheduleScene.action(/date_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
    const date = ctx.match[1];
    const text = `Ты выбрал дату: ${date}. Выбери предмет:`;
    const keyboard = getKeyboardForDate(date);

    try {
      await ctx.editMessageText(text, { reply_markup: keyboard.reply_markup });
    } catch (e) {
      if (!e.description.includes('message is not modified')) {
        console.error(e);
      }
    }
  });

  calendar.setDateListener((ctx, date) => {
    ctx.reply(
      `Ты выбрал дату: ${date}. Выбери предмет:`,
      getKeyboardForDate(date)
    );
  });

  ScheduleScene.action('exit', async (ctx) => {
    await ctx.editMessageText('Меню закрыто');
  });

  //------Choose or create group scene------
  const GroupSelector = new Scenes.WizardScene(
    'GROUP_SELECTOR',
    async (ctx) => {
      await ctx.reply('Оберіть группу:', Markup.inlineKeyboard([
        [Markup.button.callback('Створити нову', 'new')],
        [Markup.button.callback('Приєднатися', 'join')]
      ]));
      return ctx.wizard.next();
    },
    async (ctx) => {
      if (!ctx.callbackQuery)
        return;

      switch (ctx.callbackQuery.data) {
        case 'new':
          await ctx.reply('Як називається ваша група?');
          return ctx.wizard.selectStep(2);

        case 'join':
          await ctx.reply('Будьте ласкаві, уведіть код вашого запрошення.');
          return ctx.wizard.selectStep(3);

        default:
          return ctx.scene.enter('SCHEDULE');
      }
    },
    async (ctx) => {
      await Group.create({name: ctx.message.text});
      await ctx.scene.enter('SCHEDULE');
    },
    async (ctx) => {
      const inviteCode = ctx.message?.text;
      // Здесь пример проверки: ищем группу с таким кодом (или именем, если inviteCode нет)
      const group = await Group.findOne({ where: { name: inviteCode } }); // или { inviteCode }
      if (!group) {
        await ctx.reply('Такого кода нет. Попробуйте снова или нажмите /start.');
        return; // Остаёмся на этом шаге
      }
      // Здесь можно добавить пользователя в группу, если нужно
      await ctx.reply(`Вы присоединились к группе "${group.name}"`);
      await ctx.scene.enter('SCHEDULE');
    }
  );

  return new Scenes.Stage([GroupSelector, ScheduleScene]);
}