import { Telegraf, session } from 'telegraf';
import { User, UserGroup } from './Models.js';
import stage from './Scenes.js';
import 'dotenv/config';

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

bot.use(async (ctx, next) => {
  if (ctx.from) {
    const user = await User.findByPk(ctx.from.id);
    if (user) {
      const userGroup = await UserGroup.findOne({
        where: { UserId: ctx.from.id }
      });
      if (userGroup) {
        ctx.session.groupId = userGroup.GroupId;
      }
    }
  }
  return next();
});

bot.start(async (ctx) => {
  const chat = await ctx.getChat();
  const id = chat.id;
  ctx.session.user = await User.findByPk(id) || await User.create({ id });
  await ctx.scene.enter('GROUP_SELECTOR');
});

bot.command('schedule', async (ctx) => {
  if (!ctx.session.groupId && !ctx.session.group) {
    return ctx.reply('Спочатку виберіть групу. Натисніть /start');
  }

  if (!ctx.session.group) {
    ctx.session.group = await Group.findByPk(ctx.session.groupId).catch(()=>null);
  }
  return ctx.scene.enter('SCHEDULE');
});

console.log('Bot is running...');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));