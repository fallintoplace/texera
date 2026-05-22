/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { Component, OnInit } from "@angular/core";
import { FormBuilder, FormGroup, Validators, FormsModule, ReactiveFormsModule } from "@angular/forms";
import { UntilDestroy, untilDestroyed } from "@ngneat/until-destroy";
import { WorkflowActionService } from "../../../service/workflow-graph/model/workflow-action.service";
import { WorkflowPersistService } from "src/app/common/service/workflow-persist/workflow-persist.service";
import { UserService } from "../../../../common/service/user/user.service";
import { NotificationService } from "src/app/common/service/notification/notification.service";
import { ExecutionMode } from "../../../../common/type/workflow";
import { NzRadioGroupComponent, NzRadioComponent } from "ng-zorro-antd/radio";
import { NgClass, NgIf } from "@angular/common";

// Operator types (LogicalOp Jackson names) that require the workflow to
// run in MATERIALIZED mode. The matching source-of-truth on the server
// is `LoopStartOpDesc` / `LoopEndOpDesc` registered in `LogicalOp.scala`,
// and WorkflowExecutionService coerces to MATERIALIZED on its end as a
// safety net for non-frontend clients.
const LOOP_OPERATOR_TYPES = ["LoopStart", "LoopEnd"] as const;

@UntilDestroy()
@Component({
  selector: "texera-settings",
  templateUrl: "./settings.component.html",
  styleUrls: ["./settings.component.scss"],
  imports: [FormsModule, ReactiveFormsModule, NzRadioGroupComponent, NzRadioComponent, NgClass, NgIf],
})
export class SettingsComponent implements OnInit {
  settingsForm: FormGroup;

  /** True iff the current workflow contains a Loop Start / Loop End
   * operator. When true, executionMode is forced to MATERIALIZED and the
   * radio group is disabled so the UI and the engine can't disagree. */
  hasLoopOperator = false;

  constructor(
    private fb: FormBuilder,
    private workflowActionService: WorkflowActionService,
    private workflowPersistService: WorkflowPersistService,
    private userService: UserService,
    private notificationService: NotificationService
  ) {
    this.settingsForm = this.fb.group({
      dataTransferBatchSize: [
        this.workflowActionService.getWorkflowContent().settings.dataTransferBatchSize,
        [Validators.required, Validators.min(1)],
      ],
      executionMode: [this.workflowActionService.getWorkflowContent().settings.executionMode],
    });
  }

  ngOnInit(): void {
    this.settingsForm
      .get("dataTransferBatchSize")!
      .valueChanges.pipe(untilDestroyed(this))
      .subscribe((batchSize: number) => {
        if (this.settingsForm.get("dataTransferBatchSize")!.valid) {
          this.confirmUpdateDataTransferBatchSize(batchSize);
        }
      });

    this.settingsForm
      .get("executionMode")!
      .valueChanges.pipe(untilDestroyed(this))
      .subscribe((mode: ExecutionMode) => {
        this.updateExecutionMode(mode);
      });

    // Apply once on load so a workflow opened with a pre-existing loop
    // is coerced before the user ever sees the wrong mode.
    this.syncExecutionModeForLoopOperators();

    this.workflowActionService
      .workflowChanged()
      .pipe(untilDestroyed(this))
      .subscribe(() => {
        this.syncExecutionModeForLoopOperators();
        this.settingsForm.patchValue(
          {
            dataTransferBatchSize: this.workflowActionService.getWorkflowContent().settings.dataTransferBatchSize,
            executionMode: this.workflowActionService.getWorkflowContent().settings.executionMode,
          },
          { emitEvent: false }
        );
      });
  }

  /** Inspect the current workflow for loop operators. If any are present,
   * force executionMode to MATERIALIZED and disable the radio group so the
   * UI shows the same value the engine will actually run on (which the
   * server-side `WorkflowExecutionService` coerces independently as a
   * safety net). If none are present, re-enable the radio group. */
  private syncExecutionModeForLoopOperators(): void {
    const operators = this.workflowActionService.getTexeraGraph().getAllOperators();
    const hadLoop = this.hasLoopOperator;
    this.hasLoopOperator = operators.some(op => (LOOP_OPERATOR_TYPES as readonly string[]).includes(op.operatorType));

    const currentMode = this.workflowActionService.getWorkflowContent().settings.executionMode;
    if (this.hasLoopOperator && currentMode !== ExecutionMode.MATERIALIZED) {
      // Update the workflow setting; the next workflowChanged pass-through
      // patches the form to match.
      this.workflowActionService.updateExecutionMode(ExecutionMode.MATERIALIZED);
    }

    const executionModeCtrl = this.settingsForm.get("executionMode");
    if (executionModeCtrl !== null) {
      if (this.hasLoopOperator && !executionModeCtrl.disabled) {
        executionModeCtrl.disable({ emitEvent: false });
      } else if (!this.hasLoopOperator && executionModeCtrl.disabled) {
        executionModeCtrl.enable({ emitEvent: false });
      }
    }

    // First time we just discovered a loop in a workflow that was loaded
    // with PIPELINED -- surface a toast so the user understands why the
    // UI suddenly switched modes on them. Subsequent re-checks (form
    // patches, position changes, etc.) won't re-notify because hadLoop
    // is now true.
    if (this.hasLoopOperator && !hadLoop && currentMode !== ExecutionMode.MATERIALIZED) {
      this.notificationService.info(
        "Execution mode set to Materialized because this workflow contains loop operators."
      );
    }
  }

  public confirmUpdateDataTransferBatchSize(dataTransferBatchSize: number): void {
    if (dataTransferBatchSize > 0) {
      this.workflowActionService.setWorkflowDataTransferBatchSize(dataTransferBatchSize);
      if (this.userService.isLogin()) {
        this.persistWorkflow();
      }
    }
  }

  public persistWorkflow(): void {
    this.workflowPersistService
      .persistWorkflow(this.workflowActionService.getWorkflow())
      .pipe(untilDestroyed(this))
      .subscribe({
        error: (e: unknown) => this.notificationService.error((e as Error).message),
      });
  }

  public updateExecutionMode(mode: ExecutionMode) {
    this.workflowActionService.updateExecutionMode(mode);
    this.persistWorkflow();
  }

  protected readonly ExecutionMode = ExecutionMode;
}
