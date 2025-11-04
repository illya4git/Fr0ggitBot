import { Telegraf, session } from 'telegraf';
import { User, UserGroup } from './Models.js';
import stage from './Scenes.js';
import 'dotenv/config';

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

bot.use(async (ctx, next) => {
    if (ctx.from) {
        const userGroup = await UserGroup.findOne({
            where: { UserId: ctx.from.id }
        });
        if (userGroup) {
            ctx.session.groupId = userGroup.GroupId;
        }
    }
    return next();
});

bot.start(async (ctx) => {
    const id = (await ctx.getChat()).id;
    ctx.session.user = await User.findByPk(id) || await User.create({ id });
    await ctx.scene.enter('GROUP_SELECTOR');
});

bot.command('schedule', (ctx) => {
    if (!ctx.session.groupId) {
        return ctx.reply('Сначала вам нужно выбрать группу. Нажмите /start');
    }
    return ctx.scene.enter('SCHEDULE');
});

console.log('Bot is running...');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));