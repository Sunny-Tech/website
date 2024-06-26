import { Initialized, Pending, Success } from '@abraham/remotedata';
import { computed, customElement, observe, property } from '@polymer/decorators';
import '@polymer/paper-progress';
import { html, PolymerElement } from '@polymer/polymer';
import { RouterLocation } from '@vaadin/router';
import '../components/hero/hero-block';
import '../elements/content-loader';
import '../elements/filter-menu';
import '../elements/header-bottom-toolbar';
import '../elements/shared-styles';
import '../elements/sticky-element';
import { Filter } from '../models/filter';
import { FilterGroup } from '../models/filter-group';
import { RootState, store } from '../store';
import { selectFilters } from '../store/filters/selectors';
import { ReduxMixin } from '../store/mixin';
import { fetchSchedule } from '../store/schedule/actions';
import { initialScheduleState } from '../store/schedule/state';
import { fetchSessions } from '../store/sessions/actions';
import { selectFilterGroups } from '../store/sessions/selectors';
import { initialSessionsState, SessionsState } from '../store/sessions/state';
import { fetchSpeakers } from '../store/speakers/actions';
import { initialSpeakersState, SpeakersState } from '../store/speakers/state';
import { contentLoaders, heroSettings } from '../utils/data';
import { updateMetadata } from '../utils/metadata';

@customElement('schedule-page-standalone')
export class SchedulePageStandalone extends ReduxMixin(PolymerElement) {
  static get template() {
    return html`
      <style include="shared-styles flex flex-alignment">
        :host {
          display: block;
          height: 100vw;
          width: 100vw;

        }

        .container {
          min-height: 100vh;
          max-width: 100vw;
        }

        paper-progress {
          width: 100%;
          --paper-progress-active-color: var(--default-primary-color);
          --paper-progress-secondary-color: var(--default-primary-color);
        }

        .container {
          padding: 8px 16px;
        }

        @media (min-width: 640px) {
          :host {
            background-color: #fff;
          }
        }
        @media (min-width: 1070px) and (max-width: 1100px) {
          .container {
            padding: 4px 16px;
          }
        }
      </style>

      <paper-progress indeterminate hidden$="[[!pending]]"></paper-progress>

      <div class="container">
        <content-loader
          card-padding="15px"
          card-margin="16px 0"
          card-height="140px"
          avatar-size="0"
          avatar-circle="0"
          title-top-position="20px"
          title-height="42px"
          title-width="70%"
          load-from="-20%"
          load-to="80%"
          blur-width="300px"
          items-count="[[contentLoaders.itemsCount]]"
          hidden$="[[!pending]]"
          layout
        >
        </content-loader>

        <slot></slot>
      </div>
    `;
  }

  private heroSettings = heroSettings.schedule;
  private contentLoaders = contentLoaders.schedule;

  @property({ type: Object })
  schedule = initialScheduleState;
  @property({ type: Object })
  sessions = initialSessionsState;
  @property({ type: Object })
  speakers = initialSpeakersState;

  @property({ type: Array })
  private filterGroups: FilterGroup[] = [];
  @property({ type: Array })
  private selectedFilters: Filter[] = [];
  @property({ type: Object })
  private location: RouterLocation | undefined;

  override connectedCallback() {
    super.connectedCallback();
    updateMetadata(this.heroSettings.title, this.heroSettings.metaDescription);

    if (this.sessions instanceof Initialized) {
      store.dispatch(fetchSessions);
    }

    if (this.speakers instanceof Initialized) {
      store.dispatch(fetchSpeakers);
    }
  }

  override stateChanged(state: RootState) {
    super.stateChanged(state);
    this.schedule = state.schedule;
    this.speakers = state.speakers;
    this.sessions = state.sessions;
    this.filterGroups = selectFilterGroups(state);
    this.selectedFilters = selectFilters(state);
  }

  onAfterEnter(location: RouterLocation) {
    this.location = location;
  }

  @observe('sessions', 'speakers')
  private onSessionsAndSpeakersChanged(sessions: SessionsState, speakers: SpeakersState) {
    if (
      this.schedule instanceof Initialized &&
      sessions instanceof Success &&
      speakers instanceof Success
    ) {
      store.dispatch(fetchSchedule);
    }
  }

  @computed('schedule')
  get pending() {
    return this.schedule instanceof Pending;
  }
}
