import { Scenes, Markup } from 'telegraf';
import {User, Group, UserGroup} from "./Models.js";
import {message} from "telegraf/filters";

const GroupSelector = new Scenes.WizardScene(
    'GROUP_SELECTOR',
    async (ctx) => {
        const groups = (await User.findByPk(ctx.session.user.id, { include: Group })).Groups;

        await ctx.reply('Оберіть группу:', Markup.inlineKeyboard([
            ...groups.map(group => [Markup.button.callback(group.name, group.id)]),
            [Markup.button.callback('➕ Створити нову', 'new')],
            [Markup.button.callback('➡️ Приєднатися', 'join')]
        ]));
        return ctx.wizard.next();
    },

    async (ctx) => {
        const query = ctx.callbackQuery;
        if (!query)
            return;

        try {
            await ctx.telegram.answerCbQuery(query.id);
            await ctx.telegram.deleteMessage(ctx.session.user.id, ctx.callbackQuery.message.message_id);
        } catch (error) { console.error(error); }

        switch (ctx.callbackQuery.data) {
            case 'new':
                await ctx.reply('Як називається ваша група?');
                return ctx.wizard.selectStep(2);

            case 'join':
                await ctx.reply('Будьте ласкаві, уведіть код вашого запрошення.');
                return ctx.wizard.selectStep(3);

            default:
                ctx.session.group = await Group.findByPk(ctx.callbackQuery.data);
                ctx.session.isAdmin = (await UserGroup.findOne({
                    where: {
                        UserId: ctx.session.user.id,
                        GroupId: ctx.session.group.id
                    }
                })).isAdmin;

                return ctx.scene.enter('SCHEDULE');
      }
    },

    async (ctx) => {
        const group = await Group.create({name: ctx.message.text});
        await UserGroup.create({
            UserId: ctx.session.user.id,
            GroupId: group.id,
            isAdmin: true
        });

        ctx.session.isAdmin = true;
        ctx.session.group = group;
        return ctx.scene.enter('SCHEDULE');
    },

    async (ctx) => {
        const group = await Group.findOne({
           where: { inviteCode: ctx.message.text }
        });

        if (!group) {
            ctx.reply('Недійсне запрошення.');
            return ctx.scene.enter('GROUP_SELECTOR');
        }

        const member = await UserGroup.findOne({
            where: {
                UserId: ctx.session.user.id,
                GroupId: group.id
            }
        });

        if (member) {
            ctx.reply('Ви вже є в цій групі.');
            return ctx.scene.enter('GROUP_SELECTOR');
        }

        await UserGroup.create({
            UserId: ctx.session.user.id,
            GroupId: group.id
        });

        ctx.session.isAdmin = false;
        ctx.session.group = group;
        return ctx.scene.enter('SCHEDULE');
    }
);

const GroupSettings = new Scenes.WizardScene(
    'GROUP_SETTINGS',
    async (ctx) => {
        await ctx.reply('⚙️ Налаштування *' + ctx.session.group.name + '*', Markup.inlineKeyboard([
            [Markup.button.callback('👤 Учасники', 'members')],
            [Markup.button.callback('↩️ Вибір групи', 'groups')],
            [Markup.button.callback('⬅️ Назад', 'back')]
        ]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        const query = ctx.callbackQuery;
        if (!query)
            return;

        try {
            await ctx.telegram.answerCbQuery(query.id);
            await ctx.telegram.deleteMessage(ctx.session.user.id, ctx.callbackQuery.message.message_id);
        } catch (error) { console.error(error); }

        switch (ctx.callbackQuery.data) {
            case 'members':
                ctx.session.group = await Group.findByPk(ctx.session.group.id, { include: User });
                const inviteCode = ctx.session.group.inviteCode ? "\n🔗 Код запрошення: " + ctx.session.group.inviteCode : '';
                const inviteToggle = ctx.session.group.inviteCode ? "🔓 Запрошення увімкнено" : "🔒 Запрошення вимкнено";

                let buttons = [];
                for (const member of ctx.session.group.Users) {
                    const chat = await ctx.telegram.getChat(member.id)
                    const name = chat.first_name + ' ' + (chat.last_name || '');
                    const link = "https://t.me/" + chat.username;

                    buttons.push([
                        Markup.button.url(name, link),
                        ...ctx.session.isAdmin ? [
                            Markup.button.callback('❌', member.id)
                        ] : [],
                    ]);
                }

                await ctx.reply('👤 Учасники *' + ctx.session.group.name + '*' + inviteCode, Markup.inlineKeyboard([
                    ...ctx.session.isAdmin ? [
                        [Markup.button.callback(inviteToggle, 'toggleInvite')]
                    ] : [],
                    ...buttons,
                    [Markup.button.callback('⬅️ Назад', 'back')]
                ]));
                return ctx.wizard.selectStep(2);

            case 'groups':
                return ctx.scene.enter('GROUP_SELECTOR');

            case 'back':
                return ctx.scene.enter('SCHEDULE');

            case 'new':
                return;
        }
    },
    async (ctx) => {
        const query = ctx.callbackQuery;
        if (!query)
            return;

        try {
            await ctx.telegram.answerCbQuery(query.id);
            await ctx.telegram.deleteMessage(ctx.session.user.id, ctx.callbackQuery.message.message_id);
        } catch (error) { console.error(error); }

        switch (ctx.callbackQuery.data) {
            case 'toggleInvite':
                if (ctx.session.group.inviteCode) {
                    ctx.session.group.inviteCode = null;
                    await ctx.session.group.save();
                } else {
                    let success = true;
                    do {
                        try {
                            const min = 10000000;
                            const max = 99999999;
                            const code = Math.floor(Math.random() * (max - min + 1)) + min;
                            ctx.session.group.inviteCode = code;
                            await ctx.session.group.save();
                        } catch (err) {
                            console.error(err);
                            success = false;
                        }
                    } while (!success);
                }
                return ctx.scene.enter('GROUP_SETTINGS');

            case 'back':
                return ctx.scene.enter('GROUP_SETTINGS');

            default:
                return;
        }
    }
);

const Schedule = new Scenes.WizardScene(
    'SCHEDULE',
    async (ctx) => {
        if (!ctx.session.date)
            ctx.session.date = new Date();

        const formattedDate = new Intl.DateTimeFormat("uk-UA").format(ctx.session.date);
        const dayOfWeek = ctx.session.date.toLocaleDateString('uk-UA', { weekday: 'short' });

        await ctx.reply('<<< 📅 Розклад на ' + formattedDate + ' >>>', Markup.inlineKeyboard([
            [Markup.button.callback('', '1')],
            [Markup.button.callback('', '2')],
            [Markup.button.callback('', '3')],
            [Markup.button.callback('', '4')],
            [Markup.button.callback('', '5')],
            ...ctx.session.isAdmin ? [
                [Markup.button.callback('➕ Додати пару', 'new')]
            ] : [],
            [Markup.button.callback('⚙️ Налаштування', 'settings')],
            [
                Markup.button.callback('<<<', 'prev'),
                Markup.button.callback(dayOfWeek, 'date'),
                Markup.button.callback('>>>', 'next'),
            ]
        ]));

        return ctx.wizard.next();
    },

    async (ctx) => {
        const query = ctx.callbackQuery;
        if (!query)
            return;

        try {
            await ctx.telegram.answerCbQuery(query.id);
            await ctx.telegram.deleteMessage(ctx.session.user.id, ctx.callbackQuery.message.message_id);
        } catch (error) { console.error(error); }

        switch (ctx.callbackQuery.data) {
            case 'prev':
                ctx.session.date.setDate(ctx.session.date.getDate() - 1);
                return ctx.scene.enter('SCHEDULE');

            case 'next':
                ctx.session.date.setDate(ctx.session.date.getDate() + 1);
                return ctx.scene.enter('SCHEDULE');

            case 'settings':
                return ctx.scene.enter('GROUP_SETTINGS');

            case 'new':
                return;

            /*default:
                ctx.session.group = await Group.findByPk(ctx.callbackQuery.data);
                return ctx.scene.enter('SCHEDULE');*/
        }
    }
);

export default new Scenes.Stage([GroupSelector, GroupSettings, Schedule]);