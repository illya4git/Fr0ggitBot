import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import Calendar from 'telegraf-calendar-telegram';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

const testArr = [
  ['sub 1', 'sub 2', 'sub 3', 'sub 4'],
  ['sub 1', 'sub 2', 'sub 3'],
  ['sub 1', 'sub 2', 'sub 3', 'sub 4', 'sub 5']
];

const calendar = new Calendar(bot, {
  startWeekDay: 1,
  weekDayNames: ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'],
  monthNames: [
    'Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'
  ]
});

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


async function safeEditMessage(ctx, text, keyboard) {
  const message = ctx.update.callback_query?.message;
  const replyMarkup = keyboard ? keyboard.reply_markup : undefined;

  if (
    message &&
    (message.text !== text ||
    JSON.stringify(message.reply_markup) !== JSON.stringify(replyMarkup))
  ) {
    await ctx.editMessageText(text, { reply_markup: replyMarkup, parse_mode: 'Markdown' });
  }
}


bot.start((ctx) => {
  const today = new Date().toISOString().slice(0, 10);
  ctx.reply(`Сегодняшняя дата: ${today}. Выбери предмет:`, getKeyboardForDate(today));
});

bot.action(/sub_(\d{4}-\d{2}-\d{2})_(\d+)/, async (ctx) => {
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

bot.action(/back_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
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


bot.action(/calendar_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
  const date = ctx.match[1];
  const dateStr = new Date(date);
  await ctx.editMessageText('Выбери точную дату:', calendar.getCalendar(dateStr));
});

bot.action(/date_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
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

bot.action('exit', async (ctx) => {
  await safeEditMessage(ctx, 'Меню закрыто');
});

bot.launch();
