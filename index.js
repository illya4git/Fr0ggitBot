import { Telegraf, session } from 'telegraf';
import { User, UserGroup, Group } from './Models.js'; 
import stage from './Scenes.js';
import 'dotenv/config';

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());

bot.use(async (ctx, next) => {
  try {
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
  } catch (err) {
    console.error('Помилка в middleware при завантаженні сесії:', err);
  }
  return next(); 
});

bot.start(async (ctx) => {
  try {
    const chat = await ctx.getChat();
    const id = chat.id;
    const [user] = await User.findOrCreate({
      where: { id: id },
      defaults: { id: id }
    });
    ctx.session.user = user;
    await ctx.scene.enter('GROUP_SELECTOR');

  } catch (err) {
    console.error('Критична помилка в /start:', err);
    await ctx.reply('Сталася помилка під час запуску. 😕 \nБудь ласка, спробуйте натиснути /start ще раз.');
    ctx.session = {}; 
    if (ctx.scene) await ctx.scene.leave();
  }
});

bot.command('schedule', async (ctx) => {
  try {
    if (!ctx.session.groupId && !ctx.session.group) {
      return ctx.reply('Спочатку виберіть групу. Натисніть /start');
    }

    if (!ctx.session.group) {
      const group = await Group.findByPk(ctx.session.groupId); 
      
      if (!group) {
        ctx.session.groupId = undefined; 
        return ctx.reply('Не можу знайти вашу групу. Можливо, її видалили. 😥\nНатисніть /start, щоб обрати нову.');
      }
      ctx.session.group = group;
    }
    return ctx.scene.enter('SCHEDULE');

  } catch (err) {
    console.error('Критична помилка в /schedule:', err);
    await ctx.reply('Ой, сталася помилка при отриманні розкладу. 😕\nСпробуйте почати спочатку, натиснувши /start');

    ctx.session = {}; 
    if (ctx.scene) await ctx.scene.leave();
  }
});

bot.catch(async (err, ctx) => {
  console.error(`Глобальна помилка для оновлення ${ctx.update.update_id}:`, err);
  
  ctx.session = {}; 
  
  try {
    if (ctx.scene) {
      await ctx.scene.leave();
    }
  } catch (sceneErr) {
    console.error('Помилка при примусовому виході зі сцени:', sceneErr);
  }

  try {
    await ctx.reply('Ой, сталася несподівана помилка! 😕 \nМене перезавантажено. Будь ласка, почніть спочатку, натиснувши /start');
  } catch (replyErr) {
    console.error('Не вдалося надіслати повідомлення про глобальну помилку:', replyErr);
  }
});

console.log('Бот запускається...');
bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));