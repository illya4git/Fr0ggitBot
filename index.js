import { Telegraf, Scenes, session } from 'telegraf';
import { User, UserGroups } from './Models.js';
import createStage from './scenes.js';
import 'dotenv/config';

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());

const stage = createStage(bot);
bot.use(stage.middleware());

bot.use(async (ctx, next) => {
    if (ctx.from) {
        const userGroup = await UserGroups.findOne({
            where: { UserId: ctx.from.id }
        });
        if (userGroup) {
            ctx.session.groupId = userGroup.GroupId;
        }
    }
    return next();
});

bot.start(async (ctx) => {
    if (ctx.session.groupId) {
        return ctx.scene.enter('SCHEDULE');
    }
    return ctx.scene.enter('GROUP_SELECTOR');
});

bot.command('schedule', (ctx) => {
    if (!ctx.session.groupId) {
        return ctx.reply('Сначала вам нужно выбрать группу. Нажмите /start');
    }
    return ctx.scene.enter('SCHEDULE');
});



console.log('Bot is running...');
bot.launch();