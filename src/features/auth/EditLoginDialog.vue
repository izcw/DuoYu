<script setup lang="ts">
import { ref, watch } from 'vue';
import AccountPanel from './AccountPanel.vue';
import { loginPromptOpen } from './edit-access';
const dialog = ref<HTMLDialogElement>();
watch(
  loginPromptOpen,
  (open) => {
    if (open) dialog.value?.showModal();
    else dialog.value?.close();
  },
  { flush: 'post' },
);
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="edit-login"
      aria-labelledby="edit-login-title"
      @close="loginPromptOpen = false"
      @keydown.esc.stop
      @click.self="loginPromptOpen = false"
    >
      <section v-if="loginPromptOpen">
        <h2 id="edit-login-title">登录后编辑</h2>
        <p>你正在浏览官方模板。登录后即可修改自己的桌面。</p>
        <AccountPanel />
        <button type="button" autofocus @click="loginPromptOpen = false">
          继续浏览
        </button>
      </section>
    </dialog>
  </Teleport>
</template>
<style scoped>
.edit-login {
  width: min(480px, calc(100vw - 32px));
  max-height: 85svh;
  padding: 0;
  border: 0;
  border-radius: 20px;
  background: #fff;
  color: #253140;
}
.edit-login::backdrop {
  background: #10182866;
}
section {
  padding: 24px;
}
h2 {
  font-size: 20px;
  margin: 0;
}
p {
  margin: 8px 0 20px;
  color: #526072;
}
section > button {
  display: block;
  margin: 18px 0 0 auto;
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
}
</style>
