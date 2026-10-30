# DuoYu 同步服务

运行要求：Node.js 24、PostgreSQL。完整功能和生产交付见 ../../docs/cloud-sync-delivery.md。

安装：`npm ci --omit=dev --ignore-scripts`。管理员执行schema.sql迁移后，为运行角色只授予public schema USAGE及同步表的SELECT/INSERT/UPDATE/DELETE。运行角色不得拥有表、超级用户、CREATEDB、CREATEROLE或BYPASSRLS权限。不要直接使用初始化数据库账号运行服务。

通过服务端环境配置PGHOST、PGPORT、PGDATABASE、PGUSER、PGPASSWORD、PGSSLMODE、DUOYU_ISSUER、DUOYU_CLIENT_ID、SYNC_ORIGINS及PORT。不得添加VITE前缀或把数据库密码复制进扩展配置。

`node src/main.mjs`启动，默认监听127.0.0.1:5260，通过Nginx提供HTTPS。systemd和Nginx配置模板在本目录，生产私密环境文件由运维单独配置。`node src/main.mjs --migrate`仅供具备迁移权限的部署环境，不能作为运行账号每次启动时的命令。

自动化测试：`npm test`，使用本机独立的duoyu_sync_test数据库。默认本地开发容器端口55432，不连接生产数据库，不发送邮件。

备份：src/backup.mjs仅在Linux服务器以管理员权限运行，使用root可读的32字节备份密钥，AES-256-GCM加密pg_dump自定义格式。`--verify <备份路径>`验证完整性，不导出明文。恢复需先在隔离目录用同一密钥解密并验证GCM tag，再将已验证的pg_dump内容交给pg_restore；不要把未经完整性验证的流直接输入生产数据库。正式恢复前停止同步写入、备份现状，并规划客户端cursor重建。
