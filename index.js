import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();


const botApi = process.env.BOT_TOKEN;;
const bot = new Telegraf(botApi);


// список дат
const dates = [
  '2025-09-20',
  '2025-09-21',
  '2025-09-22'
];
const testArr = [
  ['sub 1',
    'sub 2',
    'sub 3',
    'sub 4'
  ],
  [
    'sub 1',
    'sub 2',
    'sub 3',
  ],
  [
    'sub 1',
    'sub 2',
    'sub 3',
    'sub 4',
    'sub 5'
  ]
]

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
    [Markup.button.callback('Exit ❌', 'exit')]
  ]);
}

bot.start((ctx) => {
  ctx.reply('Выбери дату:', getKeyboard(0));
});

// обработка выбора даты
bot.action(/date_(\d+)/, (ctx) => {
  const index = Number(ctx.match[1]);
  ctx.answerCbQuery(`Ты выбрал ${dates[index]}`);
});


bot.action(/prev_(\d+)/, async (ctx) => {
  let index = Number(ctx.match[1]);
  index = (index - 1 + dates.length) % dates.length; 
  await ctx.editMessageReplyMarkup(getKeyboard(index).reply_markup);
});


bot.action(/next_(\d+)/, async (ctx) => {
  let index = Number(ctx.match[1]);
  index = (index + 1) % dates.length; 
  await ctx.editMessageReplyMarkup(getKeyboard(index).reply_markup);
});


bot.action('exit', async (ctx) => {
  await ctx.editMessageText('Меню закрыто ✅');
});

bot.launch();