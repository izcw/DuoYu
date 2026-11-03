<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { rpc, restoreCloudBackup, formatSyncTime } from '../sync/client';
type Backup = {
  id: string;
  created_at: string;
  entity_count: number;
  revision: string;
};
const rows = ref<Backup[]>([]),
  busy = ref(false),
  error = ref(''),
  message = ref('');
const chosen = ref<{
  backup: Backup;
  epoch: string;
  revision: string;
  requestId: string;
}>();
async function load() {
  busy.value = true;
  error.value = '';
  try {
    rows.value = (await rpc('/api/v1/sync/backups')).backups;
  } catch (e) {
    error.value =
      e instanceof Error &&
      (e.message === 'not_found' ||
        (e as Error & { status?: number }).status === 404)
        ? '当前同步服务未提供云端备份接口，请检查服务版本和转发路径。'
        : e instanceof Error
          ? e.message
          : '备份加载失败';
  } finally {
    busy.value = false;
  }
}
async function select(backup: Backup) {
  busy.value = true;
  error.value = '';
  message.value = '';
  try {
    const snapshot = await rpc('/api/v1/sync/snapshot');
    chosen.value = {
      backup,
      epoch: snapshot.epoch,
      revision: snapshot.revision,
      requestId: crypto.randomUUID(),
    };
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取云端版本失败';
  } finally {
    busy.value = false;
  }
}
async function restore() {
  if (!chosen.value || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const value = chosen.value;
    await restoreCloudBackup(value.backup.id, value, value.requestId);
    chosen.value = undefined;
    message.value = '已恢复所选备份，其他设备将在同步后更新。';
    await load();
  } catch (e) {
    error.value =
      e instanceof Error
        ? (
            {
              backup_revision_changed: '云端已有新修改，请取消并重新选择备份',
              backup_asset_unavailable:
                '备份图片暂不可用，恢复已取消，请稍后重试',
              backup_not_found: '备份已轮换，请刷新列表',
              epoch_mismatch: '云端数据版本已变化，请刷新后重试',
            } as Record<string, string>
          )[e.message] || e.message
        : '恢复失败';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section class="account-backups" aria-label="云端备份记录">
    <header>
      <strong>云端备份</strong
      ><button :disabled="busy" @click="load">刷新</button>
    </header>
    <p>显示最近 5 份备份。每次成功同步数据变更时保存一份，查看或刷新不会新增备份。</p>
    <ul>
      <li v-for="row in rows" :key="row.id">
        <div>
          <strong>{{ formatSyncTime(Date.parse(row.created_at)) }}</strong
          ><small
            >{{ row.entity_count }} 项数据 · 版本 {{ row.revision }}</small
          >
        </div>
        <button :disabled="busy" @click="select(row)">恢复此备份</button>
      </li>
    </ul>
    <p v-if="!rows.length && !error">
      {{ busy ? '正在读取备份…' : '暂无云端备份' }}
    </p>
    <div
      v-if="chosen"
      class="restore-confirm"
      role="group"
      aria-label="确认恢复备份"
    >
      <strong
        >恢复到
        {{ formatSyncTime(Date.parse(chosen.backup.created_at)) }}？</strong
      >
      <p>
        将替换当前账号的桌面、收藏、文件夹、壁纸和设置，并同步到其他设备。请先同步本机修改。
      </p>
      <button :disabled="busy" @click="restore">
        {{ busy ? '正在恢复…' : '确认恢复' }}
      </button>
      <button :disabled="busy" @click="chosen = undefined">取消</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>
<style scoped>
.account-backups {
  padding: 22px;
  border: 1px solid #e8e8ed;
  border-radius: 16px;
}
header,
li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  padding: 14px 0;
  border-bottom: 1px solid #f5f5f7;
}
small {
  display: block;
  margin-top: 5px;
  color: #888;
}
p {
  color: #888;
  font-size: 13px;
  line-height: 1.6;
}
button {
  border: 0;
  border-radius: 8px;
  padding: 9px 14px;
  background: #f5f5f7;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.restore-confirm {
  margin-top: 16px;
  padding: 16px;
  border-radius: 10px;
  background: #f5f5f7;
}
.restore-confirm button {
  background: #111;
  color: white;
  margin-right: 8px;
}
[role='alert'] {
  color: #b33;
}
</style>
