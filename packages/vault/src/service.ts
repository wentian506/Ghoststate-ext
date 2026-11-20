import { Vault } from './index';
import { assertText } from '../../shared-types/src/index';
/** A narrow command surface shared by the extension worker and the standalone local UI. */
export class VaultService {
  constructor(readonly vault = new Vault()) {}
  async execute(type: string, p: Record<string, any> = {}): Promise<unknown> {
    switch (type) {
      case 'STATUS': return this.vault.status();
      case 'SETUP': return this.vault.setup(p.passphrase);
      case 'UNLOCK': return this.vault.unlock(p.passphrase);
      case 'LOCK': this.vault.lock(); return null;
      case 'LIST_PROFILES': return this.vault.listProfiles();
      case 'LIST_EVENTS': return this.vault.listEvents();
      case 'GET_SETTINGS': return this.vault.getSettings();
      case 'SET_SETTINGS': return this.vault.setSettings(p.minutes, p.logging);
      case 'ADD_PROFILE': return this.vault.addProfile(p.label, p.url, p.username, p.password);
      case 'REVEAL_PROFILE': return this.vault.revealProfile(p.id, p.passphrase);
      case 'UPDATE_PROFILE': return this.vault.updateProfile(p.id, p.label, p.url, p.username, p.password, p.passphrase);
      case 'IMPORT_PROFILES': return this.vault.importProfiles(p.records, p.passphrase);
      case 'DELETE_PROFILE': return this.vault.deleteProfile(p.id);
      case 'CLEAR_EVENTS': return this.vault.clearEvents();
      case 'GET_WORKFLOW': return this.vault.getWorkflow(p.id);
      case 'CLEAR_WORKFLOW': return this.vault.clearWorkflow(p.id);
      case 'EXPORT': return this.vault.exportBackup();
      case 'RESTORE': assertText(p.backup, 'backup', 10_000_000); return this.vault.restoreBackup(p.backup, p.passphrase);
      case 'RESET': return this.vault.reset();
      default: throw new Error('Unknown or unavailable command.');
    }
  }
}
