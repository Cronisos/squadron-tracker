"""Tests du plugin, avec des doublures des modules fournis par EDMC."""

import importlib.util
import pathlib
import sys
import types
import unittest
from unittest import mock

TOKEN = 'a' * 43


def install_stubs():
    config = types.ModuleType('config')
    config.appname = 'EDMarketConnector'
    config.config = mock.Mock()
    # Réglages d'EDMC simulés : un dictionnaire, lu et écrit par get_str et set
    config.config.store = {'squadron_tracker_token': TOKEN}
    config.config.get_str.side_effect = lambda key, default='': config.config.store.get(key, default)
    config.config.set.side_effect = lambda key, value: config.config.store.__setitem__(key, value)
    monitor = types.ModuleType('monitor')
    monitor.monitor = mock.Mock()
    monitor.monitor.is_live_galaxy.return_value = True
    session = types.ModuleType('timeout_session')
    session.new_session = mock.Mock()
    requests = types.ModuleType('requests')
    requests.RequestException = type('RequestException', (Exception,), {})
    notebook = types.ModuleType('myNotebook')
    # Uniquement les noms qui existent vraiment dans myNotebook (EDMC 6.1)
    notebook.Notebook = notebook.Frame = notebook.Label = notebook.EntryMenu = notebook.Button = mock.Mock()
    sys.modules.update({
        'config': config, 'monitor': monitor, 'timeout_session': session,
        'requests': requests, 'myNotebook': notebook, 'tkinter': mock.Mock(),
    })


def load_plugin():
    install_stubs()
    path = pathlib.Path(__file__).parents[1] / 'Squadron_Tracker' / 'load.py'
    spec = importlib.util.spec_from_file_location('load_under_test', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Base(unittest.TestCase):
    def setUp(self):
        self.load = load_plugin()
        self.load.thread = mock.Mock()
        self.entry = {
            'timestamp': '2026-11-01T10:57:02Z', 'event': 'PowerplayMerits', 'Power': 'Aisling Duval',
            'MeritsGained': 759, 'TotalMerits': 1095073,
        }


class Payload(Base):
    def test_seuls_quatre_champs_sortent(self):
        entry = {**self.entry, 'Secret': 'ne doit pas sortir'}
        self.assertEqual(self.load.build_payload('CMDR Test', 'Sol', entry), {
            'cmdr': 'CMDR Test', 'system': 'Sol', 'merits': 759, 'at': '2026-11-01T10:57:02Z',
        })

    def test_valeurs_invalides_refusees(self):
        for merits in (0, -5, '12', 1.5, True, None):
            self.assertIsNone(self.load.build_payload('C', 'X', {**self.entry, 'MeritsGained': merits}))
        self.assertIsNone(self.load.build_payload('', 'X', self.entry))


class Journal(Base):
    def queued(self):
        return self.load.outbox.qsize()

    def test_un_evenement_de_merites_est_mis_en_file(self):
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 1)

    def test_les_autres_evenements_sont_ignores(self):
        self.load.journal_entry('C', False, 'X', '', {'event': 'FSDJump', 'MeritsGained': 5}, {})
        self.assertEqual(self.queued(), 0)

    def test_beta_et_legacy_ignores(self):
        self.load.journal_entry('C', True, 'X', '', self.entry, {})
        self.load.monitor.is_live_galaxy.return_value = False
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 0)

    def test_sans_jeton_valide_rien_ne_part(self):
        self.load.config.store['squadron_tracker_token'] = 'trop-court'
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 0)

    def test_sans_serveur_valable_rien_ne_part(self):
        self.load.SERVER_URL = ''
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.load.config.store['squadron_tracker_server'] = 'http://pas-en-https.example'
        self.load.journal_entry('C', False, 'X', '', self.entry, {})
        self.assertEqual(self.queued(), 0)


class Server(Base):
    def test_adresses_acceptees_et_refusees(self):
        clean = self.load.clean_server
        self.assertEqual(clean('https://api.escadron.workers.dev/'), 'https://api.escadron.workers.dev')
        self.assertEqual(clean(' https://api.escadron.workers.dev/v1/merits '), 'https://api.escadron.workers.dev')
        for bad in ('', 'http://api.example.dev', 'https://192.168.1.10', 'https://localhost',
                    'https://api.example.dev:8443', 'https://api.example.dev/autre', 'https://a.dev?x=1'):
            self.assertEqual(clean(bad), '', bad)

    def test_le_serveur_choisi_remplace_celui_par_defaut(self):
        self.assertEqual(self.load.server_url(), self.load.SERVER_URL)
        self.load.config.store['squadron_tracker_server'] = 'https://chef.example.dev'
        self.assertEqual(self.load.server_url(), 'https://chef.example.dev')


class Prefs(Base):
    def test_la_page_de_reglages_se_construit(self):
        self.assertIsNotNone(self.load.plugin_prefs(mock.Mock(), 'C', False))

    def vars(self, server, token):
        self.load.server_var = mock.Mock(get=mock.Mock(return_value=server))
        self.load.token_var = mock.Mock(get=mock.Mock(return_value=token))

    def test_changer_de_serveur_efface_le_jeton(self):
        self.vars('https://chef.example.dev', TOKEN)
        self.load.prefs_changed('C', False)
        self.assertEqual(self.load.config.store['squadron_tracker_server'], 'https://chef.example.dev')
        self.assertEqual(self.load.config.store['squadron_tracker_token'], '')

    def test_un_jeton_colle_avec_le_nouveau_serveur_est_garde(self):
        self.vars('https://chef.example.dev', 'b' * 43)
        self.load.prefs_changed('C', False)
        self.assertEqual(self.load.config.store['squadron_tracker_token'], 'b' * 43)

    def test_meme_serveur_le_jeton_reste(self):
        self.vars(self.load.SERVER_URL, TOKEN)
        self.load.prefs_changed('C', False)
        self.assertEqual(self.load.config.store['squadron_tracker_token'], TOKEN)


class Join(Base):
    def post(self, status=200, body=None, error=None, cmdr='CMDR Test', password='secret'):
        session = mock.Mock()
        session.post.return_value = mock.Mock(status_code=status, json=mock.Mock(return_value=body or {}))
        session.post.side_effect = error
        return session, self.load.join(session, 'https://chef.example.dev', cmdr, password)

    def test_inscription_reussie(self):
        session, (token, message) = self.post(body={'cmdr': 'CMDR Test', 'token': 'c' * 43})
        self.assertEqual(token, 'c' * 43)
        self.assertIn('CMDR Test', message)
        self.assertEqual(session.post.call_args.args[0], 'https://chef.example.dev/v1/join')
        self.assertEqual(session.post.call_args.kwargs['json'], {'cmdr': 'CMDR Test', 'password': 'secret'})
        self.assertIs(session.post.call_args.kwargs['allow_redirects'], False)

    def test_refus_expliques(self):
        for status, mot in ((401, 'Mot de passe'), (404, 'fermées'), (409, 'déjà inscrit'), (429, 'essais'), (500, '500')):
            token, message = self.post(status)[1]
            self.assertIsNone(token)
            self.assertIn(mot, message)

    def test_sans_commandant_ou_mot_de_passe_rien_ne_part(self):
        session, (token, _) = self.post(cmdr='')
        self.assertIsNone(token)
        session.post.assert_not_called()
        session, (token, _) = self.post(password='')
        session.post.assert_not_called()

    def test_reponse_sans_jeton_valable(self):
        self.assertIsNone(self.post(body={'token': 'court'})[1][0])

    def test_coupure_reseau(self):
        token, message = self.post(error=self.load.requests.RequestException())[1]
        self.assertIsNone(token)
        self.assertIn('injoignable', message)

    def test_le_bouton_garde_le_jeton_et_oublie_le_mot_de_passe(self):
        self.load.plugin_prefs(mock.Mock(), 'CMDR Test', False)
        self.load.server_var = mock.Mock(get=mock.Mock(return_value='https://chef.example.dev'))
        self.load.password_var = mock.Mock(get=mock.Mock(return_value='secret'))
        self.load.token_var = mock.Mock()
        self.load.join_status_var = mock.Mock()
        session = self.load.new_session.return_value
        session.post.return_value = mock.Mock(status_code=200, json=mock.Mock(return_value={'token': 'd' * 43}))
        session.post.side_effect = None
        self.load.on_join()
        self.assertEqual(self.load.config.store['squadron_tracker_token'], 'd' * 43)
        self.assertEqual(self.load.config.store['squadron_tracker_server'], 'https://chef.example.dev')
        self.load.password_var.set.assert_called_with('')
        self.assertNotIn('secret', self.load.config.store.values())


class Deliver(Base):
    def post(self, status=None, error=None):
        session = mock.Mock()
        session.post.return_value = mock.Mock(status_code=status)
        session.post.side_effect = error
        return session, self.load.deliver(session, 'https://x/v1/merits', TOKEN, {'merits': 1})

    def test_reussite_refus_et_nouvel_essai(self):
        self.assertEqual(self.post(200)[1], 'ok')
        for status in (400, 401, 403, 413):
            self.assertEqual(self.post(status)[1], 'drop')
        for status in (302, 429, 500, 503):
            self.assertEqual(self.post(status)[1], 'retry')

    def test_coupure_reseau(self):
        self.assertEqual(self.post(error=self.load.requests.RequestException())[1], 'retry')

    def test_le_jeton_ne_suit_jamais_une_redirection(self):
        session, _ = self.post(200)
        self.assertIs(session.post.call_args.kwargs['allow_redirects'], False)
        self.assertEqual(session.post.call_args.kwargs['headers']['Authorization'], f'Bearer {TOKEN}')


if __name__ == '__main__':
    unittest.main()
