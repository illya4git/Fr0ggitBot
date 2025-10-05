import { Scenes, Markup } from 'telegraf';
import { Group, UserGroups } from "./Models.js";

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
      Group.create({name: ctx.message.text})
    },

    async (ctx) => {

    }
);

export default new Scenes.Stage([GroupSelector]);