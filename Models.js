import { Sequelize, DataTypes, Model } from 'sequelize';

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: './data/main.sqlite',
  define: { timestamps: false }
});

export class User extends Model {}
User.init({
  id: { type: DataTypes.INTEGER, primaryKey: true }
}, { sequelize, modelName: 'User' });

export class Group extends Model {}
Group.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING },
  inviteCode: { type: DataTypes.STRING, unique: true },
  labLinks: { type: DataTypes.TEXT, allowNull: true },
  deadlineList: { type: DataTypes.TEXT, allowNull: true } 
}, { sequelize, modelName: 'Group' });


export class UserGroup extends Model {}
UserGroup.init({
  UserId: { type: DataTypes.INTEGER, primaryKey: true },
  GroupId: { type: DataTypes.INTEGER, primaryKey: true },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false }
}, { sequelize, modelName: 'UserGroup', timestamps: false });

User.belongsToMany(Group, { through: UserGroup });
Group.belongsToMany(User, { through: UserGroup });

export class Subject extends Model {}
Subject.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false }
}, { sequelize, modelName: 'Subject' });
Subject.belongsTo(Group);

export class Lesson extends Model {}
Lesson.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  timestamp: { type: DataTypes.STRING, allowNull: true },
  isPractice: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  meetingLink: { type: DataTypes.STRING },
  recordingLink: { type: DataTypes.STRING },
  homework: { type: DataTypes.STRING },
  day: { type: DataTypes.STRING },
  weekType: { type: DataTypes.STRING },
  audience: { type: DataTypes.STRING, allowNull: true }
}, { sequelize, modelName: 'Lesson' });
Lesson.belongsTo(Group);
Lesson.belongsTo(Subject);

await sequelize.sync();