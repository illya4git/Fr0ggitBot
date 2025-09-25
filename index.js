import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import Calendar from 'telegraf-calendar-telegram';

dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// фиксированные даты
const dates = [
  '2025-09-20',
  '2025-09-21',
  '2025-09-22'
];


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


const customDateSubs = {};


function getKeyboard(index) {
  return Markup.inlineKeyboard([
    ...testArr[index].map((item, i) => [
      Markup.button.callback(item, `sub_${index}_${i}`)
    ]),
    [
      Markup.button.callback('<', `prev_${index}`),
      Markup.button.callback(dates[index], `date_${index}`),
      Markup.button.callback('>', `next_${index}`)
    ],
    [Markup.button.callback('Назад', `back_${index}`)],
    [Markup.button.callback('Exit', 'exit')]
  ]);
}


function getKeyboardForCustomDate(date) {
  if (!customDateSubs[date]) {
    customDateSubs[date] = ['sub 1', 'sub 2', 'sub 3'];
  }

  return Markup.inlineKeyboard([
    ...customDateSubs[date].map((item, i) => [
      Markup.button.callback(item, `sub_custom_${date}_${i}`)
    ]),
    [Markup.button.callback('Назад', `back_custom_${date}`)],
    [Markup.button.callback('Exit', 'exit')],
  ]);
}


async function safeEditMessage(ctx, text, keyboard) {
  const message = ctx.update.callback_query.message;
  const replyMarkup = keyboard ? keyboard.reply_markup : undefined;

  if (
    message.text !== text ||
    JSON.stringify(message.reply_markup) !== JSON.stringify(replyMarkup)
  ) {
    await ctx.editMessageText(text, { reply_markup: replyMarkup, parse_mode: 'Markdown' });
  }
}

bot.start((ctx) => {
  ctx.reply('Выбери дату:', getKeyboard(0));
});


bot.action(/sub_(\d+)_(\d+)/, async (ctx) => {
  const dateIndex = Number(ctx.match[1]);
  const subIndex = Number(ctx.match[2]);
  const chosen = testArr[dateIndex][subIndex];

  await safeEditMessage(ctx,
    `Ты выбрал *${chosen}* на дату ${dates[dateIndex]}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Назад', `back_${dateIndex}`)],
      [Markup.button.callback('Продолжить', `continue_${dateIndex}_${subIndex}`)]
    ])
  );
});


bot.action(/sub_custom_(\d{4}-\d{2}-\d{2})_(\d+)/, async (ctx) => {
  const date = ctx.match[1];
  const subIndex = Number(ctx.match[2]);
  const chosen = customDateSubs[date][subIndex];

  await ctx.editMessageText(
    `Ты выбрал *${chosen}* на дату ${date}`,
    {
      parse_mode: 'Markdown',
      reply_markup: getKeyboardForCustomDate(date).reply_markup
    }
  );
});


bot.action(/back_(\d+)/, async (ctx) => {
  const index = Number(ctx.match[1]);
  if (testArr[index]) {
    await safeEditMessage(ctx, 'Выбери дату:', getKeyboard(index));
  }
});


bot.action(/back_custom_(\d{4}-\d{2}-\d{2})/, async (ctx) => {
  const date = ctx.match[1];
  if (customDateSubs[date]) {
    const text = `Ты выбрал дату: ${date}. Выбери предмет:`;
    const keyboard = getKeyboardForCustomDate(date);

    try {
      await ctx.editMessageText(text, { reply_markup: keyboard.reply_markup });
    } catch (e) {
      if (!e.description.includes('message is not modified')) {
        console.error(e);
      }
    }
  }
});




bot.action(/date_(\d+)/, async (ctx) => {
  await ctx.editMessageText('Выбери точную дату:', calendar.getCalendar());
});


calendar.setDateListener((ctx, date) => {
  ctx.reply(`Ты выбрал дату: ${date}. Выбери предмет:`, getKeyboardForCustomDate(date));
});


bot.action(/prev_(\d+)/, async (ctx) => {
  let index = Number(ctx.match[1]);
  index = (index - 1 + dates.length) % dates.length;
  await safeEditMessage(ctx, 'Выбери дату:', getKeyboard(index));
});

bot.action(/next_(\d+)/, async (ctx) => {
  let index = Number(ctx.match[1]);
  index = (index + 1) % dates.length;
  await safeEditMessage(ctx, 'Выбери дату:', getKeyboard(index));
});

// выход из меню
bot.action('exit', async (ctx) => {
  await safeEditMessage(ctx, 'Меню закрыто');
});

bot.launch();
