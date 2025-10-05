import { Sequelize, DataTypes, Model } from 'sequelize';
export const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './main.sqlite',
    define: { timestamps: false }
});

export class User extends Model {}
User.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true
    }
}, {sequelize});

export class Group extends Model {}
Group.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: { type: DataTypes.STRING }
}, {sequelize});

export class UserGroups extends Model {}
UserGroups.init({
    isAdmin: { type: DataTypes.BOOLEAN }
}, {sequelize});
User.belongsToMany(Group, { through: UserGroups });
Group.belongsToMany(User, { through: UserGroups });

export class Subject extends Model {}
Subject.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {sequelize});
Subject.belongsTo(Group);

export class Lesson extends Model {}
Lesson.init({
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    timestamp: {
        type: DataTypes.DATE,
        allowNull: false
    },
    isPractice: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    meetingLink: { type: DataTypes.STRING },
    recordingLink: { type: DataTypes.STRING },
    homework: { type: DataTypes.STRING }
}, {sequelize});
Lesson.belongsTo(Group);
Lesson.belongsTo(Subject);

await sequelize.sync();