import 'dotenv/config';
import { Telegraf, session } from 'telegraf';
import { User } from "./Models.js";
import stage from "./Scenes.js";

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
bot.use(stage.middleware());

bot.start(async (ctx) => {
    const id = (await ctx.getChat()).id;
    const user = await User.findByPk(id);
    !user && await User.create({id: id});

    await ctx.scene.enter('GROUP_SELECTOR');
});

await bot.launch();
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))